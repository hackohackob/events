FROM node:20-alpine AS builder

WORKDIR /app

# Workspace install — the simulator depends on @events/contracts (the vehicle
# list and its labels are real values, not just types) and resolves it from
# source via the Vite alias, so the contracts package must be present.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/simulator/package.json apps/simulator/tsconfig.json ./apps/simulator/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/

RUN npm ci -w @events/simulator

# `tsc -b` type-checks against the built .d.ts, so contracts is compiled first.
COPY packages/contracts/src ./packages/contracts/src
RUN npm run build -w @events/contracts

COPY apps/simulator ./apps/simulator

# Build-time API/WS target (the in-app field can still override at runtime).
ARG VITE_API_URL=http://localhost:8500
ARG VITE_EVENT_ID=event-demo
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_EVENT_ID=$VITE_EVENT_ID

RUN npm run build -w @events/simulator

FROM nginx:alpine AS runtime

COPY --from=builder /app/apps/simulator/dist /usr/share/nginx/html

# Serve the SPA on 8504 with history-API fallback.
RUN printf 'server {\n  listen 8504;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8504
CMD ["nginx", "-g", "daemon off;"]
