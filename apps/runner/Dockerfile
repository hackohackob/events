FROM node:20-alpine AS builder

WORKDIR /app

# Workspace install — the runner depends on @events/contracts and resolves it
# from source via the Vite alias, so the contracts package must be present.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/runner/package.json apps/runner/tsconfig.json ./apps/runner/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/

RUN npm ci -w @events/runner

COPY packages/contracts/src ./packages/contracts/src
COPY apps/runner ./apps/runner

# Build-time API/WS targets — the PWA calls the backend cross-origin in prod,
# exactly like the coordinator web app.
ARG VITE_API_URL=http://localhost:8500/api
ARG VITE_WS_URL=http://localhost:8500/realtime
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build -w @events/runner

FROM nginx:alpine AS runtime

COPY --from=builder /app/apps/runner/dist /usr/share/nginx/html
COPY apps/runner/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8506
CMD ["nginx", "-g", "daemon off;"]
