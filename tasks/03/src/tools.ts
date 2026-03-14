import { HUB_API_KEY } from "./config.js";

const HUB_API_URL = "https://hub.ag3nts.org/api/packages";

async function callHubApi(body: object) {
  const response = await fetch(HUB_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export const toolDefinitions = [
  {
    type: "function" as const,
    name: "check_package",
    description: "Check package status by package ID",
    parameters: {
      type: "object" as const,
      properties: {
        packageid: {
          type: "string",
          description: "The package ID to check (e.g., PKG12345678)",
        },
      },
      required: ["packageid"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "redirect_package",
    description: "Redirect a package to a different destination",
    parameters: {
      type: "object" as const,
      properties: {
        packageid: {
          type: "string",
          description: "The package ID to redirect (e.g., PKG12345678)",
        },
        destination: {
          type: "string",
          description: "The destination code (e.g., PWR3847PL)",
        },
        code: {
          type: "string",
          description: "The security code for the package",
        },
      },
      required: ["packageid", "destination", "code"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const toolHandlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  check_package: async (args: Record<string, unknown>) => {
    const packageid = args.packageid as string;
    return callHubApi({
      apikey: HUB_API_KEY,
      action: "check",
      packageid,
    });
  },

  redirect_package: async (args: Record<string, unknown>) => {
    const packageid = args.packageid as string;
    const destination = args.destination as string;
    const code = args.code as string;
    return callHubApi({
      apikey: HUB_API_KEY,
      action: "redirect",
      packageid,
      destination,
      code,
    });
  },
};
