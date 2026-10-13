# ---------- build stage ----------
FROM oven/bun:1 AS builder
WORKDIR /app

# install deps first (better layer caching)
COPY package.json bun.lock ./
RUN bun install

# build the Next.js app
COPY . .
RUN bun run build

# install game server deps
RUN cd mini-services/game-server && bun install

# ---------- runtime stage ----------
FROM oven/bun:1-slim
WORKDIR /app

# Next.js standalone server
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Socket.IO game server
COPY --from=builder /app/mini-services/game-server ./mini-services/game-server

# launcher
COPY deploy/start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000 3003

CMD ["/app/start.sh"]
