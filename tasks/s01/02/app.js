import { processQuery } from "./src/executor.js";
import { api } from "./src/config.js";
import { tools, handlers } from "./src/tools/index.js";
import { fetchLocations } from "./src/utils/fetchLocations.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  model: api.model,
  tools,
  handlers,
  instructions: api.instructions
};


const main = async () => {
  const locations = await fetchLocations();
  const candidates = readFileSync(join(__dirname, "../01/transport.json"), "utf8");
  const candidatesJsonString = JSON.stringify(JSON.parse(candidates), null, 2);
  const query = `Given the following candidates: 
  ${candidatesJsonString}
  and following power plants locations:
  ${JSON.stringify(locations, null, 2)}
  find the one that matches the best the following criteria:
  - within close distance to one of the power plants
  - with high access level`
  const response = await processQuery(query, config);

  const postData = {
    apikey: process.env.HUB_API_KEY,
    task: "findhim",
    answer: response
  };

  const verifyResponse = await fetch(process.env.VERIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(postData)
  });

  const result = await verifyResponse.json();
  console.log("Verification result:", result);

};

main().catch(console.error);
