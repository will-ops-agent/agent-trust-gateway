import { Hono } from "hono";
import { cors } from "hono/cors";
import { health } from "./routes/health.js";
import { api } from "./routes/api.js";
import { createPaymentMiddleware } from "./payments/x402.js";
import { createA2ARoutes } from "./a2a/handler.js";
import { buildAgentCard } from "./agent/card.js";
import { skills } from "./agent/skills.js";
import { TrustGatewayExecutor } from "./agent/executor.js";
import { createMiddleware } from "hono/factory";
import type { Config } from "./config.js";

const PAID_A2A_METHODS = new Set(["message/send", "message/stream"]);

// Define paid endpoints with prices
const PAID_ENDPOINTS = [
  {
    path: "GET /api/agent/:id/profile",
    price: "$0.001",
    description: "Fetch agent identity and registration file",
  },
  {
    path: "GET /api/agent/*/profile",
    price: "$0.001",
    description: "Fetch agent identity and registration file",
  },
  {
    path: "POST /api/agent/profile/invoke",
    price: "$0.001",
    description: "Fetch agent identity (A2A invoke format)",
  },
  {
    path: "POST /api/agent/score/invoke",
    price: "$0.01",
    description: "Compute trust score from reputation data",
  },
  {
    path: "POST /api/agent/validate/invoke",
    price: "$0.03",
    description: "Deep validation of agent endpoints and attestations",
  },
  {
    path: "POST /a2a",
    price: "$0.01",
    description: "A2A task execution",
  },
];

// Free endpoints (no payment required)
const FREE_PATHS = new Set(["/api/health"]);

export function createApp(config: Config) {
  const app = new Hono();

  app.use(
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Payment", "X-Payment-Response"],
      exposeHeaders: ["X-Payment-Response"],
    }),
  );

  app.route("/", health);

  const paymentMiddleware = createPaymentMiddleware(config, PAID_ENDPOINTS);

  // A2A payment middleware - only for paid methods
  app.use(
    "/a2a",
    createMiddleware(async (c, next) => {
      if (config.bypassPayments) {
        await next();
        return;
      }

      const body = await c.req.json();
      if (PAID_A2A_METHODS.has(body.method)) {
        return paymentMiddleware(c, next);
      }
      await next();
    }),
  );

  // API payment middleware - skip free paths
  app.use(
    "/api/*",
    createMiddleware(async (c, next) => {
      if (config.bypassPayments) {
        await next();
        return;
      }

      const path = c.req.path;
      if (FREE_PATHS.has(path)) {
        await next();
        return;
      }
      return paymentMiddleware(c, next);
    }),
  );

  const agentCard = buildAgentCard(config, skills);
  const executor = new TrustGatewayExecutor();
  app.route("/", createA2ARoutes(agentCard, executor));
  app.route("/api", api);

  return app;
}
