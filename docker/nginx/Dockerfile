FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS frontend

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci --ignore-scripts

COPY frontend/ ./
RUN npm run build

FROM nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951

COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend /frontend/dist /usr/share/nginx/html

RUN mkdir -p /app/media /app/staticfiles /var/cache/nginx /var/run /var/log/nginx

HEALTHCHECK --interval=10s --timeout=3s CMD wget -q --spider http://127.0.0.1/api/health/ || exit 1
