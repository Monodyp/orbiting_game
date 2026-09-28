FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --global npm@11.17.0 --no-audit --no-fund \
    && npm ci

COPY . .

ARG VITE_GAME_SERVER_URL
ARG ALLOW_INSECURE_WS=false
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}

RUN node -e "const url = new URL(process.env.VITE_GAME_SERVER_URL || ''); const localOverride = process.env.ALLOW_INSECURE_WS === 'true' && url.protocol === 'ws:'; if (url.protocol !== 'wss:' && !localOverride) throw new Error('Production client builds require VITE_GAME_SERVER_URL to use wss://');" \
    && npm run build -w @ice-water/shared \
    && npm run build -w @ice-water/client

FROM nginx:1.28-alpine AS runtime

COPY --from=build /app/apps/client/dist /usr/share/nginx/html
COPY deploy/nginx/http.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/proxy-common.conf /etc/nginx/snippets/proxy-common.conf

EXPOSE 80 443