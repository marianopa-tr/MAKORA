import { getHarnessStub } from "./durable-objects/makora-harness";
import type { Env } from "./env.d";
import { handleCronEvent } from "./jobs/cron";
import { MakoraMcpAgent } from "./mcp/agent";

export { SessionDO } from "./durable-objects/session";
export { MakoraMcpAgent };
export { MakoraHarness } from "./durable-objects/makora-harness";

// ── Shared utilities ────────────────────────────────────────────────

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

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
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

// ── App handler (self-service) ──────────────────────────────────────
// Reusable handler for the self-service app routes. Authenticated via
// eToro keys in headers. Each user gets their own MakoraHarness DO.
//
// `actionPath` is the harness action, e.g. "/status", "/tick".
// ────────────────────────────────────────────────────────────────────

export async function handleAppRequest(
  request: Request,
  env: Env,
  actionPath: string,
  search: string
): Promise<Response> {
  const apiKey = request.headers.get("X-Etoro-Api-Key");
  const userKey = request.headers.get("X-Etoro-User-Key");
  if (!apiKey || !userKey) {
    return jsonError("Missing eToro credentials. Send X-Etoro-Api-Key and X-Etoro-User-Key headers.", 401);
  }

  if (!env.MAKORA_HARNESS) {
    return jsonError("MAKORA_HARNESS binding not configured", 500);
  }

  const hash = await hashKeys(apiKey, userKey);
  const appId = env.MAKORA_HARNESS.idFromName(`app-${hash}`);
  const appStub = env.MAKORA_HARNESS.get(appId);

  const appUrl = new URL(actionPath || "/status", "http://harness");
  appUrl.search = search;

  const fwdHeaders = new Headers(request.headers);
  fwdHeaders.set("X-Shared-App", "true");

  return appStub.fetch(
    new Request(appUrl.toString(), {
      method: request.method,
      headers: fwdHeaders,
      body: request.body,
    })
  );
}

// ── Full worker (default) ───────────────────────────────────────────
// Serves all routes: /health, /mcp, /agent/*, /app/*
//
// When WORKER_MODE=app, only the self-service app routes are served
// at the root level (e.g. /status, /tick instead of /app/status).
// ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isAppMode = env.WORKER_MODE === "app";

    // ── App-only mode ─────────────────────────────────────────────
    if (isAppMode) {
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

      // Every other path is an app action (e.g. /status, /tick, /config)
      const actionPath = url.pathname;
      return handleAppRequest(request, env, actionPath, url.search);
    }

    // ── Full mode (default) ───────────────────────────────────────

    if (url.pathname === "/health") {
      return jsonOk({
        status: "ok",
        timestamp: new Date().toISOString(),
        environment: env.ENVIRONMENT,
      });
    }

    if (url.pathname === "/") {
      return jsonOk({
        name: "makora",
        version: "0.3.0",
        description: "Autonomous LLM-powered trading agent on Cloudflare Workers",
        endpoints: {
          health: "/health",
          mcp: "/mcp (auth required)",
          agent: "/agent/* (auth required)",
          app: "/app/* (eToro keys in headers)",
        },
      });
    }

    if (url.pathname.startsWith("/mcp")) {
      if (!isAuthorized(request, env)) {
        return unauthorizedResponse();
      }
      return MakoraMcpAgent.mount("/mcp", { binding: "MCP_AGENT" }).fetch(request, env, ctx);
    }

    if (url.pathname.startsWith("/app/")) {
      const actionPath = url.pathname.replace("/app", "") || "/status";
      return handleAppRequest(request, env, actionPath, url.search);
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
