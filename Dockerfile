FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends zip unzip \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
  && cp -R packages/server/src/db/migrations packages/server/dist/db/migrations

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV WEB_DIST_DIR=/app/packages/web/dist

EXPOSE 8080

CMD ["node", "packages/server/dist/index.js"]
