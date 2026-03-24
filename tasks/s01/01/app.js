import {
  AI_API_KEY,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider
} from "../../config.js";
import { extractResponseText, parseCsvLine, calculateAge } from "./helpers.js";
import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MODEL = resolveModelForProvider("gpt-5.4");

/**
 * Schema for LLM tagging response
 * Returns an object containing array of tagged persons
 * Note: OpenAI requires root schema type to be "object", not "array"
 */
const taggedPersonsSchema = {
  type: "json_schema",
  name: "tagged_persons",
  strict: true,
  schema: {
    type: "object",
    properties: {
      persons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            surname: { type: "string" },
            gender: { type: "string" },
            born: { type: "number" },
            city: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags from: IT (everything related to computers), transport, edukacja, medycyna, praca z ludźmi, praca z pojazdami, praca fizyczna. Select all tags that apply to the job description."
            }
          },
          required: ["name", "surname", "gender", "born", "city", "tags"],
          additionalProperties: false
        }
      }
    },
    required: ["persons"],
    additionalProperties: false
  }
};

/**
 * Fetch and parse CSV file from URL
 * Columns: name,surname,gender,birthDate,birthPlace,birthCountry,job
 */
async function fetchCsvFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV from ${url}: ${response.status}`);
  }
  const data = await response.text();
  const lines = data.trim().split("\n");
  const header = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const obj = {};
    header.forEach((key, index) => {
      obj[key] = values[index] || "";
    });
    return obj;
  });
}

/**
 * Filter persons based on criteria:
 * - gender === "M"
 * - age >= 20 && age <= 40
 * - birthPlace === "Grudziądz"
 */
function filterPersons(persons) {
  return persons.filter((person) => {
    const age = calculateAge(person.birthDate);

    return (
      person.gender === "M" &&
      age > 20 &&
      age < 40 &&
      person.birthPlace === "Grudziądz"
    );
  });
}

/**
 * Send filtered persons file to LLM for tagging
 * Reads from filtered.json file
 */
async function tagPersonsWithLLM(filteredJsonPath) {
  // Read the filtered JSON file
  const fileContent = readFileSync(filteredJsonPath, "utf8");
  const filteredPersons = JSON.parse(fileContent);

  if (filteredPersons.length === 0) {
    console.log("No persons to tag (empty file)");
    return [];
  }

  console.log(`Sending ${filteredPersons.length} persons from file to LLM for tagging...`);

  const input = filteredPersons.map((p) => ({
    name: p.name,
    surname: p.surname,
    gender: p.gender,
    born: new Date(p.birthDate).getFullYear(),
    city: p.birthPlace,
    job: p.job
  }));

  const prompt = `Tag each person with appropriate job categories based on their job description.
Available tags:
- IT (everything related to computers)
- transport
- edukacja
- medycyna
- praca z ludźmi
- praca z pojazdami
- praca fizyczna

Persons to tag:
${JSON.stringify(input, null, 2)}

Return a JSON object with a "persons" array containing the tagged persons in the exact same order with all applicable tags for each person.`;

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      text: { format: taggedPersonsSchema }
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const message = data?.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error("Missing text output in API response");
  }

  const result = JSON.parse(outputText);
  // Extract persons array from the object wrapper (schema now uses root object)
  const taggedPersons = result.persons || [];
  console.log(`Tagged ${taggedPersons.length} persons`);
  return taggedPersons;
}

/**
 * Filter tagged persons by transport tag
 */
function filterByTransportTag(taggedPersons) {
  return taggedPersons.filter((person) =>
    person.tags && person.tags.includes("transport")
  );
}

async function sendToApi(persons) {
  const body = {
    apikey: process.env.HUB_API_KEY,
    task: "people",
    answer: persons
  };

  console.log("Sending to API...");
  console.log(JSON.stringify(body, null, 2));

  const response = await fetch("https://hub.ag3nts.org/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  const responseData = await response.json().catch(() => null);
  console.log("API response received", responseData);
  return responseData;
}

async function main() {
  // Step 1: Fetch CSV from URL
  console.log("Fetching CSV from URL...");
  const apiKey = process.env.HUB_API_KEY;
  if (!apiKey) {
    throw new Error("HUB_API_KEY environment variable is not set");
  }
  const csvUrl = `https://hub.ag3nts.org/data/${apiKey}/people.csv`;
  const persons = await fetchCsvFromUrl(csvUrl);
  console.log(`Fetched ${persons.length} total records`);

  // Step 2: Filter persons
  console.log("\nFiltering persons...");
  const filteredPersons = filterPersons(persons);
  console.log(`Filtered to ${filteredPersons.length} persons`);

  if (filteredPersons.length === 0) {
    console.log("\nNo persons match the filter criteria");
    console.log("Saving empty result to filtered.json");
    const outputPath = join(__dirname, "filtered.json");
    writeFileSync(outputPath, JSON.stringify([], null, 2));
    return;
  }

  // Display filtered persons
  filteredPersons.forEach((p) => {
    const age = calculateAge(p.birthDate);
    console.log(`  - ${p.name} ${p.surname}, age ${age}, ${p.birthPlace}`);
  });

  // Step 3: Save filtered JSON
  console.log("\nSaving filtered.json...");
  const outputPath = join(__dirname, "filtered.json");
  writeFileSync(outputPath, JSON.stringify(filteredPersons, null, 2));
  console.log(`Saved to ${outputPath}`);

  // Step 4: Tag persons with LLM
  console.log("\nTagging persons with LLM...");
  const taggedPersons = await tagPersonsWithLLM(outputPath);

  // Step 5: Filter by transport tag
  console.log("\nFiltering by transport tag...");
  const transportPersons = filterByTransportTag(taggedPersons);
  console.log(`Found ${transportPersons.length} persons with transport tag`);

  transportPersons.forEach((p) => {
    console.log(`  - ${p.name} ${p.surname}, tags: ${p.tags.join(", ")}`);
  });

  // Step 6: Send to API
  console.log("\nSending to API...");
  try {
    // await sendToApi(transportPersons);
    writeFileSync(join(__dirname, "transport.json"), JSON.stringify(transportPersons, null, 2))
    console.log("\nProcess completed successfully!");
  } catch (error) {
    // Log the request body that would have been sent
    console.log("\nWould have sent:");
    console.log(JSON.stringify({
      apikey: "tutaj-twój-klucz-api",
      task: "people",
      answer: transportPersons
    }, null, 2));
    throw error;
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});