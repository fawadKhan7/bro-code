# BroCode coordination server — builds from the REPOSITORY ROOT as context, so it
# works on hosts that build from the repo root (Back4app Containers, Hugging Face
# Spaces, and most others). The packages/Dockerfile is the packages/-context
# variant. One image serves the dashboard + REST API + WebSocket.

# ---- build stage ----------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

# The npm workspace root lives in packages/; bring its whole tree in.
COPY packages/ ./
RUN npm install --no-audit --no-fund
RUN npm run build:coord:dashboard
RUN npm prune --omit=dev

# ---- runtime stage --------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COORD_HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/coord-client ./coord-client
COPY --from=build /app/coord-server ./coord-server

# The app reads PORT (host-injected) ?? COORD_PORT ?? 4141. Point the host at 4141.
EXPOSE 4141
CMD ["node", "coord-server/dist/main.js"]
