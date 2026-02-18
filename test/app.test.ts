import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";

const testConfig: Config = {
  walletAddress: "0xtest",
  privateKey: "0xkey",
  network: "eip155:84532",
  rpcUrl: "https://sepolia.base.org",
  facilitatorUrl: "https://x402.org/facilitator",
  agentName: "Test Agent",
  agentDescription: "A test agent",
  agentUrl: "http://localhost:3000",
  port: 3000,
};

describe("Hono app routes", () => {
  const app = createApp(testConfig);

  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /.well-known/agent-card.json returns valid card", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card.name).toBe("Test Agent");
    expect(card.skills).toHaveLength(3);
    expect(card.url).toContain("/a2a");
    expect(card.entrypoints).toBeDefined();
    expect(Object.keys(card.entrypoints)).toEqual(["profile", "score", "validate"]);
    expect(card.entrypoints.profile.url).toBe("http://localhost:3000/agent/profile/invoke");
    expect(card.entrypoints.profile.method).toBe("POST");
    expect(card.entrypoints.score.pricing).toEqual({ invoke: "0.01" });
    expect(card.entrypoints.validate.input_schema.properties.checks).toBeDefined();
  });

  it("GET /api/hello without payment returns 402", async () => {
    const res = await app.request("/api/hello");
    expect(res.status).toBe(402);
  });

  it("POST /a2a message/send without payment returns 402", async () => {
    const res = await app.request("/a2a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "message/send",
        params: {
          message: {
            kind: "message",
            messageId: "test",
            role: "user",
            parts: [{ kind: "text", text: "hi" }],
          },
        },
      }),
    });
    expect(res.status).toBe(402);
  });

  it("POST /a2a tasks/get does not require payment", async () => {
    const res = await app.request("/a2a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "tasks/get",
        params: { id: "nonexistent" },
      }),
    });
    expect(res.status).not.toBe(402);
  });
});
