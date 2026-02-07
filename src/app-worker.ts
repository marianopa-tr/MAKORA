/**
 * Standalone entrypoint for app-only deployments.
 *
 * Deploy this to a separate Cloudflare Worker endpoint when you want
 * users to connect their eToro account at the root path (e.g.
 * https://makora-app.your-domain.com/status) without needing `/app/`.
 *
 * Usage:
 *   1. Copy wrangler-app.example.jsonc → wrangler-app.jsonc
 *   2. Fill in your bindings (D1, KV, R2, DOs)
 *   3. Deploy: npx wrangler deploy -c wrangler-app.jsonc
 *
 * This worker uses the exact same code as the full worker — it simply
 * sets WORKER_MODE=app so all routes are served at the root level.
 */

// Re-export Durable Object classes (Wrangler needs them in the entrypoint)
export { SessionDO } from "./durable-objects/session";
export { MakoraMcpAgent } from "./mcp/agent";
export { MakoraHarness } from "./durable-objects/makora-harness";

import type { Env } from "./env.d";
import { handleAppRequest } from "./index";

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonOk({ status: "ok", timestamp: new Date().toISOString(), mode: "app" });
    }

    if (url.pathname === "/") {
      return jsonOk({
        name: "makora-app",
        version: "0.3.0",
        description: "Makora self-service trading agent",
        mode: "app",
        endpoints: { health: "/health", status: "/status", tick: "/tick (POST)" },
      });
    }

    // Every path is an app action — /status, /tick, /config, etc.
    return handleAppRequest(request, env, url.pathname, url.search);
  },
};
