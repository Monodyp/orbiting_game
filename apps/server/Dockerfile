FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --global npm@11.17.0 --no-audit --no-fund \
    && npm ci

COPY . .
RUN npm run build -w @ice-water/shared \
    && npm run build -w @ice-water/server \
    && ./node_modules/.bin/tsx scripts/build-server.ts

FROM node:24.18.0-bookworm-slim AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --global npm@11.17.0 --no-audit --no-fund \
    && npm ci --omit=dev --workspace=@ice-water/server --workspace=@ice-water/shared \
    && npm cache clean --force

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node apps/server/package.json ./apps/server/package.json
COPY --chown=node:node packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/apps/server/dist /app/apps/server/dist
COPY --from=build --chown=node:node /app/packages/shared/dist /app/packages/shared/dist

USER node
EXPOSE 2567
CMD ["node", "apps/server/dist/main.js"]