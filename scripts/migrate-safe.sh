#!/usr/bin/env bash
set -euo pipefail

if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "Production migration: creating backup first..."
  npm run db:backup
fi
npm run db:migrate
