# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=/api
ARG VITE_AUTH_DISABLED=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_AUTH_DISABLED=$VITE_AUTH_DISABLED
RUN npm run build

# ---------- Runtime (nginx) ----------
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
