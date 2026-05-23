FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/

RUN npm ci -w @events/web

COPY packages/contracts/src ./packages/contracts/src
RUN npm run build -w @events/contracts

COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
COPY apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/postcss.config.cjs apps/web/tailwind.config.ts apps/web/tailwind.config.cjs ./apps/web/

ARG NEXT_PUBLIC_API_URL=http://localhost:8500/api
ARG NEXT_PUBLIC_WS_URL=http://localhost:8500/realtime
ARG NEXT_PUBLIC_MAPY_API_KEY=""
ARG NEXT_PUBLIC_USE_MAPY_TILES=false

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_MAPY_API_KEY=$NEXT_PUBLIC_MAPY_API_KEY
ENV NEXT_PUBLIC_USE_MAPY_TILES=$NEXT_PUBLIC_USE_MAPY_TILES

RUN npm run build -w @events/web

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci -w @events/web --omit=dev

COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 8503
CMD ["npm", "run", "start", "-w", "@events/web"]
