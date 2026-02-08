# ── Stage 1: Install dependencies ──
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build all packages ──
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/
COPY packages/frontend/ packages/frontend/
RUN pnpm --filter @nit-scs/shared build
RUN pnpm --filter @nit-scs/frontend build
RUN cd packages/backend && npx prisma generate
RUN pnpm --filter @nit-scs/backend build

# ── Stage 3: Production runtime ──
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy everything needed from the build stage
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY --from=build /app/packages/backend/prisma packages/backend/prisma
COPY --from=build /app/packages/backend/package.json packages/backend/package.json
COPY --from=build /app/packages/backend/node_modules packages/backend/node_modules
COPY --from=build /app/packages/frontend/dist packages/frontend/dist

# Copy data directory for settings
COPY packages/backend/data packages/backend/data

WORKDIR /app/packages/backend
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/index.js"]
