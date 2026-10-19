# Build stage
FROM node:24-slim AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies based on package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy application source (includes LICENSE, configs, src, public)
COPY . .

# Build server and UI assets (TypeScript + Vite)
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev --no-audit --no-fund

# Production runtime stage
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HTTP_HOST=0.0.0.0

# Copy runtime assets and production node_modules with node user ownership
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/server.json ./
COPY --from=builder --chown=node:node /app/LICENSE ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 8080

CMD ["node", "dist/server.js", "--http"]
