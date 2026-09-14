FROM node:22.14.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.2
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile --filter @home-ops/server...
RUN DATABASE_URL=mysql://build:build@localhost:3306/build pnpm --filter @home-ops/server build

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY apps/server/smb/requirements.txt /tmp/smb-requirements.txt
RUN python3 -m venv /opt/smb && /opt/smb/bin/pip install --no-cache-dir -r /tmp/smb-requirements.txt
ENV SMB_PYTHON=/opt/smb/bin/python
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
WORKDIR /app/apps/server
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
