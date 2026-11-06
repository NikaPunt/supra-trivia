# For Fly.io. The same app as the main Dockerfile, but it runs as root because Fly mounts volumes owned by root.
# (Each Fly machine is its own small VM, so the container is already isolated.)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
