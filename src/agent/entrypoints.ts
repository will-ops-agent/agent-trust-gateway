// Structured entrypoint definitions for programmatic agent discovery.
// Complements A2A skills (conversational) with JSON Schemas and pricing.

export interface Entrypoint {
  url: string;
  method: string;
  description: string;
  streaming: boolean;
  input_schema: Record<string, unknown>;
  pricing?: { invoke: string };
}

const CHAIN_DESCRIPTION =
  "Target chain for registry lookup. Options: base, base-sepolia, ethereum, sepolia";

interface EntrypointTemplate {
  path: string;
  method: string;
  description: string;
  streaming: boolean;
  input_schema: Record<string, unknown>;
  pricing?: { invoke: string };
}

const templates: Record<string, EntrypointTemplate> = {
  profile: {
    path: "/agent/profile/invoke",
    method: "POST",
    description:
      "Fetch agent identity from the ERC-8004 Identity Registry ($0.001). Returns name, description, owner, wallet, endpoints, and supported trust methods.",
    streaming: false,
    input_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        agentId: {
          type: ["string", "number"],
          description: "ERC-8004 token ID",
        },
        chain: {
          type: "string",
          default: "base",
          description: CHAIN_DESCRIPTION,
        },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    pricing: { invoke: "0.001" },
  },
  score: {
    path: "/agent/score/invoke",
    method: "POST",
    description:
      "Compute trust score (0-100) from ERC-8004 reputation data ($0.01). Returns verdict, scoring breakdown, and feedback summary.",
    streaming: false,
    input_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        agentId: {
          type: ["string", "number"],
          description: "ERC-8004 token ID",
        },
        chain: {
          type: "string",
          default: "base",
          description: CHAIN_DESCRIPTION,
        },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    pricing: { invoke: "0.01" },
  },
  validate: {
    path: "/agent/validate/invoke",
    method: "POST",
    description:
      "Deep validation of agent endpoints, wallet, and attestations ($0.03). Returns per-check results and overall verdict.",
    streaming: false,
    input_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        agentId: {
          type: ["string", "number"],
          description: "ERC-8004 token ID",
        },
        chain: {
          type: "string",
          default: "base",
          description: CHAIN_DESCRIPTION,
        },
        checks: {
          type: "array",
          items: {
            type: "string",
            enum: ["endpoints", "wallet", "attestations"],
          },
          default: ["endpoints", "wallet"],
          description:
            "Checks to run. Defaults to endpoints + wallet if omitted.",
        },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    pricing: { invoke: "0.03" },
  },
};

/** Resolve entrypoint templates into full URLs using the agent's base URL. */
export function buildEntrypoints(
  baseUrl: string,
): Record<string, Entrypoint> {
  const origin = baseUrl.replace(/\/+$/, "");
  const result: Record<string, Entrypoint> = {};
  for (const [key, { path, ...rest }] of Object.entries(templates)) {
    result[key] = { url: `${origin}${path}`, ...rest };
  }
  return result;
}
