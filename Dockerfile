# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci

COPY backend ./backend
RUN cd backend && npm run build && npm prune --omit=dev

# ---------- Python deps stage ----------
# Instala no site-packages default (/usr/local/lib/python3.12) — o runtime
# copia /usr/local inteiro (interpretador + stdlib + deps) deste stage.
FROM python:3.12-slim-bookworm AS pydeps
WORKDIR /app
COPY pipeline/requirements.txt ./pipeline/requirements.txt
RUN pip install --no-cache-dir -r pipeline/requirements.txt

# ---------- Runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PIPELINE_PYTHON_BIN=/usr/local/bin/python3.12
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils libffi8 libssl3 zlib1g libbz2-1.0 liblzma5 \
    libreadline8 libsqlite3-0 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# python3.12 + stdlib + deps do pipeline (bookworm em ambos os stages)
COPY --from=pydeps /usr/local /usr/local

COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
COPY backend/drizzle ./backend/drizzle
COPY pipeline ./pipeline

WORKDIR /app/backend

EXPOSE 8080

# Services:
#   api     → node dist/index.js        (default CMD)
#   workers → node dist/worker.js
CMD ["node", "dist/index.js"]
