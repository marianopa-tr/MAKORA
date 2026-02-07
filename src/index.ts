import { getHarnessStub } from "./durable-objects/makora-harness";
import type { Env } from "./env.d";
import { handleCronEvent } from "./jobs/cron";
import { MakoraMcpAgent } from "./mcp/agent";

export { SessionDO } from "./durable-objects/session";
export { MakoraMcpAgent };
export { MakoraHarness } from "./durable-objects/makora-harness";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = env.MAKORA_API_TOKEN;
  if (!token) return false;
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return constantTimeCompare(authHeader.slice(7), token);
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized. Requires: Authorization: Bearer <MAKORA_API_TOKEN>" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Hash eToro API keys into a stable, short identifier for DO instance naming. */
async function hashKeys(apiKey: string, userKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${apiKey}:${userKey}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "makora",
          version: "0.3.0",
          description: "Autonomous LLM-powered trading agent on Cloudflare Workers",
          endpoints: {
            health: "/health",
            mcp: "/mcp (auth required)",
            agent: "/agent/* (auth required)",
            app: "/app/* (eToro keys in headers)",
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname.startsWith("/mcp")) {
      if (!isAuthorized(request, env)) {
        return unauthorizedResponse();
      }
      return MakoraMcpAgent.mount("/mcp", { binding: "MCP_AGENT" }).fetch(request, env, ctx);
    }

    // ── App routes (self-service) ──────────────────────────────────────
    // Authenticated via eToro keys in headers, NOT the server API token.
    // Each user gets their own MakoraHarness DO instance keyed by a hash
    // of their credentials. Shared signal intelligence is fetched by the
    // per-user harness from the main harness directly.
    // ────────────────────────────────────────────────────────────────────
    if (url.pathname.startsWith("/app/")) {
      const apiKey = request.headers.get("X-Etoro-Api-Key");
      const userKey = request.headers.get("X-Etoro-User-Key");
      if (!apiKey || !userKey) {
        return jsonError("Missing eToro credentials. Send X-Etoro-Api-Key and X-Etoro-User-Key headers.", 401);
      }

      if (!env.MAKORA_HARNESS) {
        return jsonError("MAKORA_HARNESS binding not configured", 500);
      }

      // Per-user harness instance keyed by credential hash
      const hash = await hashKeys(apiKey, userKey);
      const appId = env.MAKORA_HARNESS.idFromName(`app-${hash}`);
      const appStub = env.MAKORA_HARNESS.get(appId);

      // Forward to the per-user harness with self-service flag.
      // Shared signals are fetched by the harness itself (via
      // MAKORA_HARNESS binding) to avoid large-header issues.
      const appPath = url.pathname.replace("/app", "") || "/status";
      const appUrl = new URL(appPath, "http://harness");
      appUrl.search = url.search;

      const fwdHeaders = new Headers(request.headers);
      fwdHeaders.set("X-Demo-Mode", "true");

      return appStub.fetch(
        new Request(appUrl.toString(), {
          method: request.method,
          headers: fwdHeaders,
          body: request.body,
        })
      );
    }

    if (url.pathname.startsWith("/agent")) {
      const stub = getHarnessStub(env);
      const agentPath = url.pathname.replace("/agent", "") || "/status";
      const agentUrl = new URL(agentPath, "http://harness");
      agentUrl.search = url.search;
      return stub.fetch(
        new Request(agentUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })
      );
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronId = event.cron;
    console.log(`Cron triggered: ${cronId} at ${new Date().toISOString()}`);
    ctx.waitUntil(handleCronEvent(cronId, env));
  },
};
