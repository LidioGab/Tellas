FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/backend/package*.json ./apps/backend/

# Install dependencies
RUN npm ci

# Copy sources
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Build shared and backend
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/backend

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/backend/package*.json ./apps/backend/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/src ./packages/shared/src
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

EXPOSE 8080

CMD ["node", "apps/backend/dist/index.js"]
