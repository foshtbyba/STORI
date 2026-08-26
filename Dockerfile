# ---- build ------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# Prisma needs a URL string to generate the client; nothing connects to it here.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate && npx next build

# ---- run --------------------------------------------------------------
# The runner keeps the full node_modules rather than a traced subset: the
# container runs `prisma migrate deploy` on boot, and the Prisma CLI drags in
# dependencies that tracing leaves behind. A larger image beats a container
# that cannot migrate.
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat \
  && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/scripts ./scripts
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/next.config.ts ./next.config.ts

USER app
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -H 0.0.0.0 -p 3000"]
