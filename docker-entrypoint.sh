#!/bin/sh
set -e

# ── Generate .dev.vars from Docker environment variables ─────────────
# Wrangler reads this file for local secrets / env vars.
# ─────────────────────────────────────────────────────────────────────

: > /app/.dev.vars  # truncate

# ── Required: LLM provider ──────────────────────────────────────────
echo "LLM_PROVIDER=${LLM_PROVIDER:-openai-raw}" >> /app/.dev.vars
echo "LLM_MODEL=${LLM_MODEL:-gpt-4o-mini}"       >> /app/.dev.vars

# ── Security tokens (auto-generated if not provided) ────────────────
if [ -z "$MAKORA_API_TOKEN" ]; then
  MAKORA_API_TOKEN=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))")
  echo "[docker] Auto-generated MAKORA_API_TOKEN"
fi
echo "MAKORA_API_TOKEN=$MAKORA_API_TOKEN" >> /app/.dev.vars

if [ -z "$KILL_SWITCH_SECRET" ]; then
  KILL_SWITCH_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))")
  echo "[docker] Auto-generated KILL_SWITCH_SECRET"
fi
echo "KILL_SWITCH_SECRET=$KILL_SWITCH_SECRET" >> /app/.dev.vars

# ── Optional: LLM API keys ─────────────────────────────────────────
for var in OPENAI_API_KEY OPENAI_BASE_URL \
           AZURE_API_KEY AZURE_RESOURCE_NAME AZURE_ENDPOINT \
           ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY \
           XAI_API_KEY DEEPSEEK_API_KEY \
           CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID CLOUDFLARE_AI_GATEWAY_ID CLOUDFLARE_AI_GATEWAY_TOKEN; do
  eval val=\$$var
  [ -n "$val" ] && echo "$var=$val" >> /app/.dev.vars
done

# ── Optional: eToro keys for shared signal gathering ────────────────
# Individual users' keys come from browser headers, not here.
# These are only needed if you want the main harness to gather signals.
for var in ETORO_API_KEY ETORO_USER_KEY ETORO_ENV; do
  eval val=\$$var
  [ -n "$val" ] && echo "$var=$val" >> /app/.dev.vars
done

# ── Optional: miscellaneous ─────────────────────────────────────────
for var in DEBUG DISCORD_WEBHOOK_URL TWITTER_BEARER_TOKEN; do
  eval val=\$$var
  [ -n "$val" ] && echo "$var=$val" >> /app/.dev.vars
done

echo "[docker] Starting Makora Shared App worker on port 8788..."
exec npx wrangler dev -c wrangler-app.jsonc --ip 0.0.0.0 --persist-to .wrangler/state
