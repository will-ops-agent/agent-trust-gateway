import type { AgentSkill } from "@a2a-js/sdk";

// Agent Trust Gateway skills
export const skills: AgentSkill[] = [
  {
    id: "agent-profile",
    name: "Agent Profile",
    description:
      "Fetch an agent's identity and registration file from the ERC-8004 Identity Registry. Returns name, description, endpoints, supported trust methods, and wallet address. Costs $0.002 USDC per request.",
    tags: ["erc-8004", "identity", "profile", "discovery", "x402"],
    examples: [
      "Get the profile for agent 42",
      "Show me agent 100's identity",
      "Fetch agent details for ID 15 on Base",
      "What endpoints does agent 7 have?",
    ],
  },
  {
    id: "trust-score",
    name: "Trust Score",
    description:
      "Compute a trust score (0-100) for an agent based on reputation data from the ERC-8004 Reputation Registry. Analyzes feedback volume, average ratings, identity maturity, and consistency. Costs $0.01 USDC per request.",
    tags: ["erc-8004", "reputation", "trust", "scoring", "x402"],
    examples: [
      "What's the trust score for agent 42?",
      "Score agent 100 on Base Sepolia",
      "Is agent 15 trustworthy?",
      "Get reputation summary for agent 7",
    ],
  },
  {
    id: "validate-agent",
    name: "Validate Agent",
    description:
      "Deep validation of an agent including endpoint reachability, wallet verification, and attestation checks. Returns detailed validation report with issues. Costs $0.03 USDC per request.",
    tags: ["erc-8004", "validation", "endpoints", "health", "x402"],
    examples: [
      "Validate agent 42's endpoints",
      "Check if agent 100 is healthy",
      "Run validation on agent 15",
      "Are agent 7's services reachable?",
    ],
  },
];
