<h1 align="center">Doko</h1>

<p align="center">
  Open-source investigation management, automation and collaboration platform.
</p>

<p align="center">
  <a href="https://github.com/mosquitototo/Doko-project/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/mosquitototo/Doko-project?display_name=tag&sort=semver"></a>
  <a href="https://github.com/mosquitototo/Doko-project/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Docker Compose" src="https://img.shields.io/badge/deployment-Docker%20Compose-2496ED?logo=docker&logoColor=white">
  <img alt="Python 3.12" src="https://img.shields.io/badge/backend-Python%203.12-3776AB?logo=python&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/frontend-React%2019-61DAFB?logo=react&logoColor=black">
</p>

<p align="center">
  <img width="180" alt="Doko" src="frontend/public/Doko_logo_small.png">
</p>

## About Doko

Doko brings alerts, cases, hunts, tasks and investigation data into one web application. It supports structured workflows, granular access control, external connectors, automation rules, case reports and an optional AI assistant backed by an internal or external OpenAI-compatible endpoint.

Doko is built with passion by developers and elevated by controlled AI assistance.

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Example alerts](#example-alerts)
- [Configuration](#configuration)
- [Administrator account](#administrator-account)
- [External services](#external-services)
- [Documentation](#documentation)
- [Updating and backups](#updating-and-backups)
- [Development checks](#development-checks)
- [Versioning](#versioning)
- [Support and license](#support-and-license)

## Features

- Alert with qualification, assignment, comments and merge-to-case workflows
- Case management with IoCs, assets, attachments, workbooks, comments, exchanges and timelines
- Hunts with journals, IoCs, assets and linked cases
- Tasks linked to users, customers and cases
- Customer-scoped roles and granular permissions
- LLM-assisted chat (Catbot)
- SOAR integration and investigation templates
- Internal automation rules for alerts, cases and hunts
- Connectors to connect external APIs (VT, AbuseIPDB, ...)
- Case report templates with PDF generation

## Screenshots

### Dashboard

<img width="1194" alt="Doko dashboard" src="https://github.com/user-attachments/assets/1d161c18-8b63-42a4-86e5-4b97eb6cb0d2">

### Cases

<img width="1202" alt="Doko case details" src="https://github.com/user-attachments/assets/eb5b5645-c2e9-4b3b-af26-da123cca0987">

### Alerts

<img width="1192" alt="Doko alerts" src="https://github.com/user-attachments/assets/0a96da0f-7840-43a6-b1af-858049b8e7b7">

### Catbot

<img width="715" alt="Doko Catbot assistant" src="https://github.com/user-attachments/assets/8f10bb1f-6eeb-4252-ae01-7924593528b8">

## Architecture

The default stack contains seven services:

| Service | Purpose |
| --- | --- |
| `nginx` | Serves the frontend, media files and reverse-proxies the API |
| `web` | Django API, authentication, migrations and administration tasks |
| `celery-worker` | Runs background jobs, automation and outbound audit forwarding |
| `celery-beat` | Schedules recurring jobs |
| `connector_hub` | Executes signed, allowlisted connector requests |
| `postgres` | Stores application data |
| `redis` | Celery broker and result backend |

## Quick start

Requirements:

- Docker Engine with the Compose plugin
- Git

Clone the repository and create the environment file:

```bash
git clone https://github.com/mosquitototo/Doko-project.git
cd Doko-project
cp .env.example .env
```

Edit `.env` and replace at least these values:

```dotenv
POSTGRES_PASSWORD=use-a-unique-database-password
DJANGO_SECRET_KEY=use-a-unique-random-value-of-at-least-32-characters
```

Build and start Doko:

```bash
docker compose up -d --build
```

Check the service state:

```bash
docker compose ps
```

With the example bind settings, Doko is available at <http://127.0.0.1:8080>.

## Example alerts

Add sample alerts to a running instance:

```bash
docker compose exec web python manage.py seed_alerts_example
```

## Configuration

All deployment configuration is read from `.env`. The example file documents the available installation variables.

| Variable | Purpose | Default in the example |
| --- | --- | --- |
| `DOKO_HTTP_BIND` | Address exposed by Nginx | `127.0.0.1` |
| `DOKO_HTTP_PORT` | HTTP port exposed by Nginx | `8080` |
| `DJANGO_ALLOWED_HOSTS` | Hostnames accepted by Django | Local and example hostnames |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Origins allowed for browser sessions | Local and example origins |
| `DJANGO_CORS_ALLOWED_ORIGINS` | Origins allowed to call the API from a browser | Local and example origins |
| `DJANGO_SECURE_SSL_REDIRECT` | Redirect requests to HTTPS | `0` |
| `DJANGO_COOKIE_SECURE` | Restrict session and CSRF cookies to HTTPS | `0` |
| `DOKO_ADMIN_USERNAME` | Initial administrator username | `admin` |
| `DOKO_ADMIN_EMAIL` | Initial administrator email | `admin@local` |
| `DOKO_ADMIN_PASSWORD` | Optional initial administrator password | Generated when omitted |
| `DOKO_BACKUP_DIR` | Backup storage path inside the web container | `/app/media/backups` |

For remote access, set the public host and origins explicitly. When TLS terminates at a reverse proxy in front of Doko, enable secure redirect and secure cookies.

`CONNECTOR_HMAC_SECRET` is optional. When it is absent, both internal services derive the same connector signing secret from `DJANGO_SECRET_KEY`; no manual calculation is required.

## Administrator account

The first startup creates an administrator only when none exists. If `DOKO_ADMIN_PASSWORD` is omitted, a strong password is generated and printed once in the web service logs:

```bash
docker compose logs web
```

Search for `DOKO INITIAL SUPERUSER CREATED`. Existing administrator credentials are never overwritten by a restart.

Change a generated password after the first login and store it securely. A replacement administrator can also be created from the container when necessary:

```bash
docker compose exec web python manage.py createsuperuser
```

## External services

LLM and SOAR providers, investigation templates, connectors, the outbound proxy and Splunk HEC are configured from the Doko interface.

- Internal LLM and SOAR endpoints may use HTTP when they are reachable only on a trusted network.
- Connector endpoints require HTTPS and an explicitly allowed domain.
- The instance proxy is used by LLM, SOAR, connector and Splunk HEC requests.
- Splunk HEC forwards structured audit events. Tokens and proxy passwords are stored encrypted and are never returned by the settings API.
- Chat context is permission-checked and limited to the sections selected for the request.

## Documentation

Usage, configuration and API guides are available inside Doko under **Settings → Documentation**. They cover:

- LLM, SOAR and investigation templates
- automation rules
- connectors
- instance settings, proxy and Splunk HEC
- case report templates
- API authentication and automation examples

The API is exposed under `/api/`. Authentication supports browser sessions and API tokens according to the permissions assigned to the account.

## Updating and backups

Create and download a database backup from **Settings → Instance settings** before an update. Generated backups are kept in the persistent media volume by default. Persistent Docker volumes should also be included in the host backup policy.

Update the checkout and rebuild the stack:

```bash
git pull
docker compose up -d --build
docker compose ps
```

Database migrations run automatically during startup. Review the web service logs after an update:

```bash
docker compose logs --tail=100 web
```

## Development checks

Backend tests run in the application container:

```bash
docker compose run --rm web python manage.py test core
```

Frontend validation runs from the `frontend` directory with Node.js 22:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

## Versioning

Doko uses semantic version tags. Tagged releases are available on the [GitHub releases page](https://github.com/mosquitototo/Doko-project/releases). Review release notes and create a backup before moving between versions.

## Support and license

Use [GitHub Issues](https://github.com/mosquitototo/Doko-project/issues) for reproducible bugs and feature requests. Do not include credentials, tokens, investigation content or other sensitive data in an issue.

Doko is released under the [MIT License](LICENSE).
