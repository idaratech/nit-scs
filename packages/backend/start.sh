#!/bin/sh
echo "==> Running Prisma db push (creating/updating tables)..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "WARNING: prisma db push failed"
echo "==> Seeding database..."
node dist/seed/seed.js 2>&1 || echo "INFO: Seed skipped"
echo "==> Starting server..."
exec node dist/index.js
