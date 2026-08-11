# BroCode Phase 2 — coordination server (NestJS + socket.io).
# Build context is the `packages/` workspace root.
#
# Multi-stage: build all needed workspaces + stage the Next.js dashboard, then
# ship a slim runtime image that just runs the compiled server.

# ---- build stage ----------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

# Install every workspace (root package.json globs reference all of them).
COPY . .
RUN npm install --no-audit --no-fund

# Build coord-client + coord-server AND stage the dashboard, so the single
# deployed URL serves the UI, the REST API, and the WebSocket together — one
# link, nothing else to host.
RUN npm run build:coord:dashboard

# Drop dev dependencies to shrink what we copy into the runtime image.
RUN npm prune --omit=dev

# ---- runtime stage --------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COORD_HOST=0.0.0.0

# App code + pruned production node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/coord-client ./coord-client
COPY --from=build /app/coord-server ./coord-server

# The host injects PORT; main.ts reads PORT ?? COORD_PORT ?? default (4141).
EXPOSE 4141
CMD ["node", "coord-server/dist/main.js"]
