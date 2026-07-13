FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p /tmp/request-manager-build/uploads /tmp/request-manager-build/tmp /tmp/request-manager-build/backups \
    && DATABASE_PATH=/tmp/request-manager-build/request-manager.db \
       UPLOADS_PATH=/tmp/request-manager-build/uploads \
       TEMP_UPLOADS_PATH=/tmp/request-manager-build/tmp \
       BACKUP_PATH=/tmp/request-manager-build/backups \
       npm run db:migrate \
    && DATABASE_PATH=/tmp/request-manager-build/request-manager.db \
       UPLOADS_PATH=/tmp/request-manager-build/uploads \
       TEMP_UPLOADS_PATH=/tmp/request-manager-build/tmp \
       BACKUP_PATH=/tmp/request-manager-build/backups \
       npm run build

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 10001 request-manager \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin request-manager

COPY --from=builder --chown=10001:10001 /app /app
RUN mkdir -p /app/data && chown 10001:10001 /app/data

USER request-manager
EXPOSE 13001

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
