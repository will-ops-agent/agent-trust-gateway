import { Hono } from "hono";
import { z } from "zod";
import { createPublicClient, http, type Address, type Chain } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
import { IdentityClient, ReputationClient, ViemAdapter } from "erc-8004-js";

// ERC-8004 Contract Addresses (same on all chains)
const IDENTITY_REGISTRY_MAINNET = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;
const REPUTATION_REGISTRY_MAINNET = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address;
const IDENTITY_REGISTRY_TESTNET = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const REPUTATION_REGISTRY_TESTNET = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;

// Chain configs
const CHAINS: Record<string, { chain: Chain; rpc: string; identityRegistry: Address; reputationRegistry: Address }> = {
  base: {
    chain: base,
    rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    identityRegistry: IDENTITY_REGISTRY_MAINNET,
    reputationRegistry: REPUTATION_REGISTRY_MAINNET,
  },
  "base-sepolia": {
    chain: baseSepolia,
    rpc: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    identityRegistry: IDENTITY_REGISTRY_TESTNET,
    reputationRegistry: REPUTATION_REGISTRY_TESTNET,
  },
  ethereum: {
    chain: mainnet,
    rpc: process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
    identityRegistry: IDENTITY_REGISTRY_MAINNET,
    reputationRegistry: REPUTATION_REGISTRY_MAINNET,
  },
  sepolia: {
    chain: sepolia,
    rpc: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
    identityRegistry: IDENTITY_REGISTRY_TESTNET,
    reputationRegistry: REPUTATION_REGISTRY_TESTNET,
  },
};

const DEFAULT_CHAIN = "base";

// Registration file type (matches ERC-8004 spec)
interface RegistrationFile {
  type?: string;
  name: string;
  description: string;
  image?: string;
  endpoints?: Array<{ name: string; endpoint: string; version?: string }>;
  registrations?: Array<{ agentId: number | null; agentRegistry: string }>;
  supportedTrust?: string[];
  active?: boolean;
  x402Support?: boolean;
}

// Helper to parse data: URIs (base64 JSON)
function parseDataUri(uri: string): Record<string, unknown> | null {
  const match = uri.match(/^data:application\/json;base64,(.+)$/);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// Helper to fetch registration file (handles data: URIs)
async function fetchRegistrationFile(identity: IdentityClient, agentId: bigint): Promise<RegistrationFile> {
  const tokenUri = await identity.getTokenURI(agentId);
  
  // Handle data: URI
  const dataUriResult = parseDataUri(tokenUri);
  if (dataUriResult) {
    return dataUriResult as unknown as RegistrationFile;
  }
  
  // Handle IPFS or HTTPS
  let fetchUrl = tokenUri;
  if (tokenUri.startsWith("ipfs://")) {
    const cid = tokenUri.replace("ipfs://", "");
    fetchUrl = `https://ipfs.io/ipfs/${cid}`;
  }
  
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch registration file: ${response.status}`);
  }
  return response.json() as Promise<RegistrationFile>;
}

// Helper to create clients
function createClients(chainName: string = DEFAULT_CHAIN) {
  const config = CHAINS[chainName] || CHAINS[DEFAULT_CHAIN];
  
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpc),
  });
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new ViemAdapter(publicClient as any);
  
  return {
    identity: new IdentityClient(adapter, config.identityRegistry),
    reputation: new ReputationClient(adapter, config.reputationRegistry, config.identityRegistry),
    chainId: config.chain.id,
  };
}

// Input schemas
const profileInputSchema = z.object({
  agentId: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  chain: z.string().optional().default(DEFAULT_CHAIN),
});

const scoreInputSchema = z.object({
  agentId: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  chain: z.string().optional().default(DEFAULT_CHAIN),
});

const validateInputSchema = z.object({
  agentId: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  chain: z.string().optional().default(DEFAULT_CHAIN),
  checks: z.array(z.enum(["endpoints", "wallet", "attestations"])).optional().default(["endpoints", "wallet"]),
});

// A2A invoke envelope schemas
const invokeEnvelopeSchema = z.object({
  input: z.any(),
});

const api = new Hono();

// Health check
api.get("/health", (c) => c.json({ ok: true, service: "agent-trust-gateway" }));

/**
 * GET /agent/:id/profile
 * Fetch agent identity and registration file
 * Price: $0.002
 */
api.get("/agent/:id/profile", async (c) => {
  const agentIdParam = c.req.param("id");
  const chain = c.req.query("chain") || DEFAULT_CHAIN;
  
  try {
    const agentId = BigInt(agentIdParam);
    const { identity } = createClients(chain);
    
    // Get registration file (with data: URI support)
    const registrationFile = await fetchRegistrationFile(identity, agentId);
    
    // Get owner
    const owner = await identity.getOwner(agentId);
    
    // Try to get agent wallet (may fail if not set)
    let wallet: string | null = null;
    try {
      wallet = await identity.getMetadata(agentId, "agentWallet");
    } catch {
      // Wallet not set, use owner as fallback
      wallet = owner;
    }
    
    return c.json({
      agentId: agentId.toString(),
      chain,
      owner,
      wallet,
      name: registrationFile.name,
      description: registrationFile.description,
      image: registrationFile.image,
      endpoints: registrationFile.endpoints || [],
      supportedTrust: registrationFile.supportedTrust || [],
      active: (registrationFile as { active?: boolean }).active ?? true,
      registrations: registrationFile.registrations || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Failed to fetch agent profile", details: message }, 500);
  }
});

/**
 * POST /agent/profile/invoke
 * A2A-compatible wrapper for profile endpoint
 * Price: $0.002
 */
api.post("/agent/profile/invoke", async (c) => {
  const body = await c.req.json().catch(() => null);
  const envelope = invokeEnvelopeSchema.safeParse(body);
  
  if (!envelope.success) {
    return c.json({ error: "Invalid request body", details: envelope.error.flatten() }, 400);
  }
  
  const parsed = profileInputSchema.safeParse(envelope.data.input);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  
  const { agentId, chain } = parsed.data;
  
  try {
    const { identity } = createClients(chain);
    const registrationFile = await fetchRegistrationFile(identity, agentId);
    const owner = await identity.getOwner(agentId);
    
    let wallet: string | null = null;
    try {
      wallet = await identity.getMetadata(agentId, "agentWallet");
    } catch {
      wallet = owner;
    }
    
    return c.json({
      output: {
        agentId: agentId.toString(),
        chain,
        owner,
        wallet,
        name: registrationFile.name,
        description: registrationFile.description,
        image: registrationFile.image,
        endpoints: registrationFile.endpoints || [],
        supportedTrust: registrationFile.supportedTrust || [],
        active: (registrationFile as { active?: boolean }).active ?? true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Failed to fetch agent profile", details: message }, 500);
  }
});

/**
 * POST /agent/score/invoke
 * Compute trust score from reputation data
 * Price: $0.01
 */
api.post("/agent/score/invoke", async (c) => {
  const body = await c.req.json().catch(() => null);
  const envelope = invokeEnvelopeSchema.safeParse(body);
  
  if (!envelope.success) {
    return c.json({ error: "Invalid request body", details: envelope.error.flatten() }, 400);
  }
  
  const parsed = scoreInputSchema.safeParse(envelope.data.input);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  
  const { agentId, chain } = parsed.data;
  
  try {
    const { identity, reputation } = createClients(chain);
    
    // Get basic profile info
    const registrationFile = await fetchRegistrationFile(identity, agentId);
    const owner = await identity.getOwner(agentId);
    
    // Get reputation summary
    const summary = await reputation.getSummary(agentId);
    
    // Get all feedback for detailed analysis
    const allFeedback = await reputation.readAllFeedback(agentId);
    
    // Compute trust vector components
    const feedbackCount = Number(summary.count);
    const avgScore = summary.averageScore;
    
    // Identity maturity: based on registration age, metadata completeness
    const hasEndpoints = (registrationFile.endpoints?.length || 0) > 0;
    const hasTrustMethods = (registrationFile.supportedTrust?.length || 0) > 0;
    const identityMaturity = (hasEndpoints ? 30 : 0) + (hasTrustMethods ? 20 : 0) + (registrationFile.description?.length > 50 ? 10 : 0);
    
    // Reputation confidence: based on feedback volume and consistency
    const volumeScore = Math.min(30, feedbackCount * 3); // Max 30 points for 10+ feedbacks
    const consistencyScore = feedbackCount > 0 ? Math.min(20, (100 - computeVariance(allFeedback.scores)) / 5) : 0;
    const reputationConfidence = volumeScore + consistencyScore;
    
    // Compute overall trust score (0-100)
    const baseScore = avgScore; // 0-100 from feedback
    const maturityBonus = identityMaturity * 0.3; // Up to 18 points
    const confidenceBonus = reputationConfidence * 0.2; // Up to 10 points
    
    // If no feedback, base score is 50 (neutral)
    const effectiveBaseScore = feedbackCount > 0 ? baseScore : 50;
    const trustScore = Math.min(100, Math.max(0, Math.round(effectiveBaseScore + maturityBonus + confidenceBonus)));
    
    // Determine verdict
    const verdict = trustScore >= 80 ? "highly-trusted" :
                    trustScore >= 60 ? "trusted" :
                    trustScore >= 40 ? "neutral" :
                    trustScore >= 20 ? "low-trust" : "untrusted";
    
    return c.json({
      output: {
        agentId: agentId.toString(),
        chain,
        trustScore,
        verdict,
        breakdown: {
          feedbackScore: Math.round(effectiveBaseScore),
          identityMaturity,
          reputationConfidence,
          formula: "score = feedbackAvg + (identityMaturity * 0.3) + (reputationConfidence * 0.2)",
        },
        feedbackSummary: {
          count: feedbackCount,
          averageScore: Math.round(avgScore * 10) / 10,
          uniqueClients: new Set(allFeedback.clientAddresses).size,
        },
        agentName: registrationFile.name,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Failed to compute trust score", details: message }, 500);
  }
});

/**
 * POST /agent/validate/invoke
 * Deep validation of agent endpoints and attestations
 * Price: $0.03
 */
api.post("/agent/validate/invoke", async (c) => {
  const body = await c.req.json().catch(() => null);
  const envelope = invokeEnvelopeSchema.safeParse(body);
  
  if (!envelope.success) {
    return c.json({ error: "Invalid request body", details: envelope.error.flatten() }, 400);
  }
  
  const parsed = validateInputSchema.safeParse(envelope.data.input);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  
  const { agentId, chain, checks } = parsed.data;
  
  try {
    const { identity, reputation } = createClients(chain);
    
    // Get profile
    const registrationFile = await fetchRegistrationFile(identity, agentId);
    const owner = await identity.getOwner(agentId);
    
    const validationReport: {
      endpointStatus: Array<{ name: string; endpoint: string; status: string; latencyMs?: number; error?: string }>;
      walletStatus: { address: string; valid: boolean; isOwner: boolean };
      attestations: Array<{ type: string; status: string; details?: string }>;
      overallVerdict: string;
      issues: string[];
    } = {
      endpointStatus: [],
      walletStatus: { address: "", valid: false, isOwner: false },
      attestations: [],
      overallVerdict: "pending",
      issues: [],
    };
    
    // Check endpoints
    if (checks.includes("endpoints") && registrationFile.endpoints) {
      for (const ep of registrationFile.endpoints) {
        const startTime = Date.now();
        try {
          // Probe endpoint with timeout
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(ep.endpoint, {
            method: "HEAD",
            signal: controller.signal,
          }).catch(() => null);
          
          clearTimeout(timeout);
          
          if (response && response.ok) {
            validationReport.endpointStatus.push({
              name: ep.name,
              endpoint: ep.endpoint,
              status: "reachable",
              latencyMs: Date.now() - startTime,
            });
          } else {
            validationReport.endpointStatus.push({
              name: ep.name,
              endpoint: ep.endpoint,
              status: "unreachable",
              error: response ? `HTTP ${response.status}` : "Connection failed",
            });
            validationReport.issues.push(`Endpoint ${ep.name} is unreachable`);
          }
        } catch (error) {
          validationReport.endpointStatus.push({
            name: ep.name,
            endpoint: ep.endpoint,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          validationReport.issues.push(`Endpoint ${ep.name} probe failed`);
        }
      }
    }
    
    // Check wallet
    if (checks.includes("wallet")) {
      let wallet: string = owner;
      try {
        const walletMeta = await identity.getMetadata(agentId, "agentWallet");
        if (walletMeta) wallet = walletMeta;
      } catch {
        // Use owner as fallback
      }
      
      const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(wallet);
      validationReport.walletStatus = {
        address: wallet,
        valid: isValidAddress,
        isOwner: wallet.toLowerCase() === owner.toLowerCase(),
      };
      
      if (!isValidAddress) {
        validationReport.issues.push("Invalid wallet address format");
      }
    }
    
    // Check attestations
    if (checks.includes("attestations") && registrationFile.supportedTrust) {
      for (const trustType of registrationFile.supportedTrust) {
        if (trustType === "reputation") {
          const summary = await reputation.getSummary(agentId);
          validationReport.attestations.push({
            type: "reputation",
            status: Number(summary.count) > 0 ? "active" : "no-feedback",
            details: `${summary.count} feedbacks, avg score: ${Math.round(summary.averageScore)}`,
          });
        } else if (trustType === "tee-attestation") {
          // TEE attestations would require additional verification
          validationReport.attestations.push({
            type: "tee-attestation",
            status: "declared",
            details: "TEE attestation verification not yet implemented",
          });
        } else if (trustType === "crypto-economic") {
          validationReport.attestations.push({
            type: "crypto-economic",
            status: "declared",
            details: "Crypto-economic validation not yet implemented",
          });
        } else {
          validationReport.attestations.push({
            type: trustType,
            status: "unknown",
          });
        }
      }
    }
    
    // Determine overall verdict
    const reachableEndpoints = validationReport.endpointStatus.filter((e) => e.status === "reachable").length;
    const totalEndpoints = validationReport.endpointStatus.length;
    const walletValid = validationReport.walletStatus.valid;
    
    if (validationReport.issues.length === 0) {
      validationReport.overallVerdict = "validated";
    } else if (reachableEndpoints === totalEndpoints && walletValid) {
      validationReport.overallVerdict = "validated-with-warnings";
    } else if (reachableEndpoints > 0 || walletValid) {
      validationReport.overallVerdict = "partial";
    } else {
      validationReport.overallVerdict = "failed";
    }
    
    return c.json({
      output: {
        agentId: agentId.toString(),
        chain,
        agentName: registrationFile.name,
        ...validationReport,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Failed to validate agent", details: message }, 500);
  }
});

// Helper function to compute variance of scores
function computeVariance(scores: number[]): number {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const squaredDiffs = scores.map((s) => Math.pow(s - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / scores.length);
}

export { api };
