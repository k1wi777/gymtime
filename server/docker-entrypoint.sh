#!/bin/sh
# Applies pending migrations, then starts the API. Prisma serialises
# concurrent `migrate deploy` runs with an advisory lock, so a rolling deploy
# with two containers is safe. RUN_MIGRATIONS=false skips it (when migrations
# are applied by a separate step).
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. See .env.production.example." >&2
  exit 1
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  node ../node_modules/prisma/build/index.js migrate deploy
fi

exec node dist/main.js
