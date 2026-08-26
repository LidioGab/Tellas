FROM node:20-alpine AS base
WORKDIR /app

# ─── Install Dependencies ────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/

# Install only production dependencies for the monorepo
RUN npm ci --workspace=packages/shared --workspace=apps/backend --ignore-scripts

# ─── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages/shared/ packages/shared/
COPY apps/backend/ apps/backend/
COPY tsconfig.base.json ./

# Build shared first, then backend
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/backend

# ─── Production ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Copy only what's needed for production
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/apps/backend/dist/ apps/backend/dist/
COPY --from=build /app/apps/backend/package.json apps/backend/
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./

# Install production dependencies only
RUN npm ci --workspace=packages/shared --workspace=apps/backend --omit=dev --ignore-scripts

EXPOSE 3001

CMD ["node", "apps/backend/dist/index.js"]
