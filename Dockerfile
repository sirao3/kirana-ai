# Build web + server, then ship a node-only runtime (server is a self-contained bundle).
FROM node:22-slim AS build
WORKDIR /app
RUN npm i -g pnpm@9.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "apps/server/dist/index.cjs"]
