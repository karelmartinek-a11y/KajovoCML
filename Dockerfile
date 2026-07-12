FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @kcml/admin-ui build
RUN pnpm --filter @kcml/server build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
