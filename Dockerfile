# Production image (VPS). Build: docker build -t hikari .  — see docs/RUNBOOK.md
# Not yet built in CI: Docker isn't available on the development machine.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only; real values come from the runtime environment.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    APP_SECRET=build-placeholder-build-placeholder-00 CRON_SECRET=build-placeholder-00 \
    npx prisma generate && npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/app/storage/uploads
RUN useradd --system --uid 1001 app && mkdir -p /app/storage/uploads && chown -R app /app/storage
COPY --from=build --chown=app /app/.next/standalone ./
COPY --from=build --chown=app /app/.next/static ./.next/static
COPY --from=build --chown=app /app/public ./public
# Migrations run from this image too: docker compose run --rm migrate
COPY --from=deps --chown=app /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps --chown=app /app/prisma ./prisma
COPY --chown=app prisma.config.ts ./
USER app
VOLUME ["/app/storage"]
EXPOSE 3000
CMD ["node", "server.js"]
