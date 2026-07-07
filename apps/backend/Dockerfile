FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/tsconfig.json apps/backend/tsconfig.build.json ./apps/backend/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/

RUN npm ci

COPY apps/backend/src ./apps/backend/src
COPY packages/contracts/src ./packages/contracts/src
COPY infra/migrations ./infra/migrations
COPY scripts ./scripts

RUN npm run build -w @events/contracts && npm run build -w @events/backend

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN npm ci --omit=dev

COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/infra/migrations ./infra/migrations
COPY example-data ./example-data
# Hospitals seed lives outside /app/apps/backend/data because that dir is a
# volume mount in prod (events_data) and would shadow an image-baked copy.
COPY apps/backend/data/hospitals.bg.json ./example-data/hospitals.bg.json

RUN addgroup -S app && adduser -S app -G app && \
    mkdir -p /app/apps/backend/uploads/incidents \
             /app/apps/backend/data && \
    chown -R app:app /app/apps/backend/uploads \
                     /app/apps/backend/data

USER app

EXPOSE 8500
CMD ["sh", "-c", "npm run migrate:sql -w @events/backend && npm run start -w @events/backend"]
