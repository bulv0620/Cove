FROM node:22.14.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.2
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile --filter @home-ops/server... --filter @home-ops/web...
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web ./apps/web
RUN DATABASE_URL=mysql://build:build@localhost:3306/build pnpm --filter @home-ops/server build
RUN pnpm --filter @home-ops/web build

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY apps/server/smb/requirements.txt /tmp/smb-requirements.txt
RUN python3 -m venv /opt/smb && /opt/smb/bin/pip install --no-cache-dir -r /tmp/smb-requirements.txt
ENV SMB_PYTHON=/opt/smb/bin/python
ENV NODE_ENV=production
ENV WEB_STATIC_ROOT=/app/public
COPY --from=build --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/web/dist /app/public
WORKDIR /app/apps/server
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
