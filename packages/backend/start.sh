#!/bin/sh
set -e

echo "==> Running Prisma db push (creating tables)..."
npx prisma db push --skip-generate --accept-data-loss

echo "==> Seeding database..."
node dist/seed/seed.js || echo "Seed skipped (may already be seeded)"

echo "==> Starting server..."
exec node dist/index.js
