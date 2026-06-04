FROM node:22-alpine AS frontend

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.30.2-alpine

COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend /frontend/dist /usr/share/nginx/html

RUN mkdir -p /app/media /app/staticfiles /var/cache/nginx /var/run /var/log/nginx

HEALTHCHECK --interval=10s --timeout=3s CMD wget -q --spider http://127.0.0.1/healthz || exit 1