# Paramedic Event App

Monorepo implementing the mobile-first paramedic event coordination platform.

## Workspaces
- `apps/backend` - NestJS API + Socket.IO realtime gateway
- `apps/mobile` - React Native (Expo) MVP client
- `packages/contracts` - shared TypeScript contracts
- `infra/migrations` - Postgres/PostGIS SQL migrations

## Quick Start
```bash
npm install
npm run lint
npm run build
```

## Run Backend Locally
```bash
npm run dev:backend
```

## Run Mobile Locally
```bash
npm run dev:mobile
```

## Docker
```bash
cp .env.example .env
docker compose up --build
```

See `docs/deployment-runbook.md` for staged and production deployment flow.
