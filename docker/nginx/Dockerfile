FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS frontend

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci --ignore-scripts

COPY frontend/ ./
RUN npm run build

FROM nginx:1.30.2-alpine@sha256:5f979dcfed4ce6461873f087e8c980d6e29b084b9e8776d9704a7e989b5f4898

COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend /frontend/dist /usr/share/nginx/html

RUN mkdir -p /app/media /app/staticfiles /var/cache/nginx /var/run /var/log/nginx

HEALTHCHECK --interval=10s --timeout=3s CMD wget -q --spider http://127.0.0.1/api/health/ || exit 1
