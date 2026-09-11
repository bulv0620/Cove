FROM node:22.14.0-bookworm-slim AS build
RUN npm install --global pnpm@9.12.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @home-ops/web...
RUN pnpm --filter @home-ops/web build

FROM nginx:1.28.0-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
