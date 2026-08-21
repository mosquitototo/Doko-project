FROM python:3.12-slim-bookworm@sha256:a116514e19457bcb7af7efe9c3dd0b9b71e85b317694e7882a1c52aa15a78134

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_ONLY_BINARY=:all:

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    libffi-dev \
    pkg-config \
    gosu \
    curl \
    ca-certificates \
    lsb-release \
    \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libjpeg62-turbo \
    libopenjp2-7 \
    libglib2.0-0 \
    fonts-dejavu-core \
    fonts-liberation \
    shared-mime-info \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --show-error --silent \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pip==26.2.1

COPY requirements-lock.txt /tmp/requirements-lock.txt
RUN pip install --no-cache-dir -r /tmp/requirements-lock.txt
RUN python -c "import cryptography; print('cryptography OK')"

COPY ./src /app

COPY ./docker/web/entrypoint.sh /entrypoint.sh
COPY ./docker/web/drop-privileges.sh /drop-privileges.sh
RUN groupadd --system doko \
    && useradd --system --gid doko --home-dir /app --shell /usr/sbin/nologin doko \
    && mkdir -p /app/media /app/staticfiles /app/celerybeat \
    && chown -R doko:doko /app /entrypoint.sh /drop-privileges.sh \
    && chmod +x /entrypoint.sh /drop-privileges.sh

ENTRYPOINT ["/drop-privileges.sh"]
CMD ["/entrypoint.sh"]
