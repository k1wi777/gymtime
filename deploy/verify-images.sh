#!/usr/bin/env bash
# V17 (slow): the production images build and work.
#
# Builds the API and panel images, starts the API with ONLY environment
# variables against a disposable PostgreSQL, waits for /health, checks that the
# migrations were applied, that it fails clearly without DATABASE_URL, that
# /docs is off in production and that the panel sends its CSP/security
# headers. Everything it creates (containers, network, images) is removed at
# the end. Needs Docker and network access to pull base images; without Docker
# it ends with an explicit SKIP.
#
#   deploy/verify-images.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  echo "SKIP: Docker is not available; the images were not verified." >&2
  exit 0
fi

ID="gtverify$$"
NET="$ID-net"
PG="$ID-pg"
API="$ID-api"
WEB="$ID-web"
SERVER_IMG="$ID-server:test"
WEB_IMG="$ID-web:test"
API_URL="https://api.verify.example"
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  # Volumes created by THIS run's containers (the PostgreSQL image declares an
  # anonymous one). Only those are checked and removed, never anyone else's.
  local mine="" c v
  for c in "$API" "$WEB" "$PG" "$ID-nodb"; do
    mine+=" $(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$c" 2>/dev/null || true)"
  done
  docker rm -fv "$API" "$WEB" "$PG" "$ID-nodb" >/dev/null 2>&1 || true
  for v in $mine; do
    if docker volume inspect "$v" >/dev/null 2>&1; then
      docker volume rm "$v" >/dev/null 2>&1 || true
      echo "WARN: a volume of this run was left behind and was removed: ${v:0:12}" >&2
    fi
  done
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker rmi -f "$SERVER_IMG" "$WEB_IMG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== Build =="
docker build -q -f "$ROOT/server/Dockerfile" -t "$SERVER_IMG" "$ROOT" >/dev/null
echo "ok   server image"
if docker build -q -f "$ROOT/web/Dockerfile" -t "$ID-web:noarg" "$ROOT/web" >/dev/null 2>&1; then
  docker rmi -f "$ID-web:noarg" >/dev/null 2>&1 || true
  fail "the panel image built without NEXT_PUBLIC_API_URL"
fi
echo "ok   panel image refuses to build without NEXT_PUBLIC_API_URL"
docker build -q --build-arg NEXT_PUBLIC_API_URL="$API_URL" -f "$ROOT/web/Dockerfile" -t "$WEB_IMG" "$ROOT/web" >/dev/null
echo "ok   panel image"

echo "== API without DATABASE_URL =="
OUT="$(docker run --name "$ID-nodb" --rm "$SERVER_IMG" 2>&1 || true)"
grep -q "DATABASE_URL is not set" <<<"$OUT" || fail "no clear error without DATABASE_URL: $OUT"
echo "ok   fails with a clear message"

echo "== API against a disposable PostgreSQL =="
docker network create "$NET" >/dev/null
PGPASS="$(openssl rand -hex 12)"
docker run -d --name "$PG" --network "$NET" -e POSTGRES_USER=gt -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=gt postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  docker exec "$PG" pg_isready -U gt -d gt >/dev/null 2>&1 && break
  sleep 1
done
docker run -d --name "$API" --network "$NET" -p 127.0.0.1::3000 \
  -e NODE_ENV=production -e PORT=3000 \
  -e DATABASE_URL="postgresql://gt:$PGPASS@$PG:5432/gt" \
  -e ADMIN_API_KEY="$(openssl rand -hex 16)" \
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  "$SERVER_IMG" >/dev/null
API_PORT="$(docker port "$API" 3000/tcp | head -n1 | sed 's/.*://')"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  [[ "$(docker inspect -f '{{.State.Running}}' "$API")" == "true" ]] || break
  sleep 1
done
if [[ $ok -ne 1 ]]; then docker logs "$API" 2>&1 | tail -20 >&2; fail "the API did not answer /health"; fi
echo "ok   /health answers"
APPLIED="$(docker exec "$PG" psql -U gt -d gt -qtAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
EXPECTED="$(find "$ROOT/server/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"
[[ "$APPLIED" == "$EXPECTED" ]] || fail "migrations applied: $APPLIED of $EXPECTED"
echo "ok   $APPLIED migrations applied"
HEADERS="$(curl -fsSI "http://127.0.0.1:$API_PORT/health")"
grep -qi '^x-content-type-options: nosniff' <<<"$HEADERS" || fail "API security headers missing"
if grep -qi '^x-powered-by' <<<"$HEADERS"; then fail "x-powered-by is exposed"; fi
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/docs")" == "404" ]] || fail "/docs is published in production"
echo "ok   API headers and /docs off in production"
[[ "$(docker inspect -f '{{.Config.User}}' "$API")" != "" && "$(docker exec "$API" id -u)" != "0" ]] || fail "the API runs as root"
echo "ok   API runs as a non-root user"

echo "== Panel =="
docker run -d --name "$WEB" -p 127.0.0.1::3000 "$WEB_IMG" >/dev/null
WEB_PORT="$(docker port "$WEB" 3000/tcp | head -n1 | sed 's/.*://')"
ok=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" 2>/dev/null; then ok=1; break; fi
  sleep 1
done
[[ $ok -eq 1 ]] || { docker logs "$WEB" 2>&1 | tail -20 >&2; fail "the panel did not answer /login"; }
HEADERS="$(curl -fsSI "http://127.0.0.1:$WEB_PORT/login")"
grep -qi "^content-security-policy:.*connect-src 'self' $API_URL" <<<"$HEADERS" || fail "CSP without the API origin"
grep -qi "^content-security-policy:.*script-src 'self' 'nonce-" <<<"$HEADERS" || fail "CSP without nonce"
grep -qi '^x-frame-options: DENY' <<<"$HEADERS" || fail "X-Frame-Options missing"
grep -qi '^strict-transport-security' <<<"$HEADERS" || fail "HSTS missing in production"
if grep -qi '^x-powered-by' <<<"$HEADERS"; then fail "the panel exposes x-powered-by"; fi
echo "ok   panel headers and CSP with the API origin"

echo "V17 passed."
