#!/bin/sh
set -e

write_dev_vars() {
  : > /app/.dev.vars

  echo "LLM_PROVIDER=${LLM_PROVIDER:-openai-raw}" >> /app/.dev.vars
  echo "LLM_MODEL=${LLM_MODEL:-gpt-4o-mini}" >> /app/.dev.vars

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

  for var in OPENAI_API_KEY OPENAI_BASE_URL \
             AZURE_API_KEY AZURE_RESOURCE_NAME AZURE_ENDPOINT \
             ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY \
             XAI_API_KEY DEEPSEEK_API_KEY \
             CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID CLOUDFLARE_AI_GATEWAY_ID CLOUDFLARE_AI_GATEWAY_TOKEN; do
    eval val=\$$var
    if [ -n "$val" ]; then
      echo "$var=$val" >> /app/.dev.vars
    fi
  done

  for var in ETORO_API_KEY ETORO_USER_KEY ETORO_ENV; do
    eval val=\$$var
    if [ -n "$val" ]; then
      echo "$var=$val" >> /app/.dev.vars
    fi
  done

  for var in DEBUG DISCORD_WEBHOOK_URL TWITTER_BEARER_TOKEN; do
    eval val=\$$var
    if [ -n "$val" ]; then
      echo "$var=$val" >> /app/.dev.vars
    fi
  done

  return 0
}

shutdown() {
  echo "[docker] Shutting down..."
  if [ -n "$NGINX_PID" ]; then
    kill "$NGINX_PID" 2>/dev/null || true
  fi
  if [ -n "$WORKER_PID" ]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  wait "$NGINX_PID" 2>/dev/null || true
  wait "$WORKER_PID" 2>/dev/null || true
  exit 0
}

write_dev_vars

echo "[docker] Starting Makora worker on 0.0.0.0:8788..."
npx wrangler dev -c wrangler-app.jsonc --ip 0.0.0.0 --persist-to .wrangler/state &
WORKER_PID=$!

trap shutdown INT TERM

echo "[docker] Waiting for worker health..."
attempt=0
until node -e "fetch('http://127.0.0.1:8788/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "[docker] Worker health check timed out; continuing startup."
    break
  fi
  sleep 1
done

echo "[docker] Starting nginx on port 80..."
nginx -g "daemon off;" &
NGINX_PID=$!

while true; do
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[docker] Worker process exited."
    kill "$NGINX_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    exit 1
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "[docker] Nginx process exited."
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
    exit 1
  fi

  sleep 2
done
