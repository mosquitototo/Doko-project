# Doko SOC ticketing tool

Doko is a ticketing platform designed for SOC teams to manage security work in one place. It provides a clear workspace for handling alerts, cases, tasks, hunts, and investigation notes while keeping context easy to follow.

Use LLM and the Catbot to ask for qualification or summarize cases, alerts, ...

Its goal is to make day-to-day security operations more structured, traceable, and easier to manage from detection to resolution.

#### Dashboard
<img width="1194" height="564" alt="image" src="https://github.com/user-attachments/assets/1d161c18-8b63-42a4-86e5-4b97eb6cb0d2" />

#### Case
<img width="1202" height="505" alt="image" src="https://github.com/user-attachments/assets/eb5b5645-c2e9-4b3b-af26-da123cca0987" />

#### Alerts
<img width="1195" height="425" alt="image" src="https://github.com/user-attachments/assets/839021a0-d2c1-4810-9c9e-26e1fe235eff" />

#### Catbot (yes we love cats)  
<img width="715" height="735" alt="image" src="https://github.com/user-attachments/assets/8f10bb1f-6eeb-4252-ae01-7924593528b8" />


## Features list

- `Alerts` are security events triggered via API
- `Cases` are merge alerts or manual creation
- `Hunts` are manual tasks designed to search for threats on a network
- `IoC & Assets` listing and enrichment
- `Workbooks` to assist with processing inside a case
- `Exchanges` to track exchanges via email or any communication platform, inside a case
  - You can enable automatic followup to these messages
  - You can reply to messages, inside the Doko platform or "Send" button (this is a external action to configure with an orchestrator / SOAR)
  - Replies are custom messages or quickparts
- `Incident Timeline` where you can enter and view the events for a case
- `Connectors` allow you to integrate APIs from external tools such as VirusTotal or AbuseIPDB
- `AI & SOAR`
  - `LLM Provider` you can configure an internal or external LLM provider
    - `Catbot` you can discuss with a chatbot when a LLM provider is configured, to help you to analyze cases, alerts, iocs, ...
  - `SOAR Providers` allow you to configure different orchestrator providers
  - `Investigation templates` allow you to configure, via a SOAR Provider, actions launched via the Catbot

Please note that there may still be a few bugs inside Doko. If you find any, please let us know.

# Installation guide

## 1. Clone the repository
```
git clone https://github.com/mosquitototo/Doko-project.git
cd Doko-project
```

## 2. Create the environment file

Copy the example environment file:
`cp .env.example .env`

Open `.env` and update the values before starting Doko.
At minimum, change all default secrets and passwords. The following values should not be kept unchanged in production:
```
POSTGRES_PASSWORD=
DJANGO_SECRET_KEY=
```

## 3. Configure the public access URL

By default, Doko is exposed locally on port 8080.
If the default values are kept, Doko will be available at:
`http://127.0.0.1:8080`

For a remote server, update the relevant values in `.env`, especially:
```
DOKO_HTTP_BIND=0.0.0.0
DOKO_HTTP_PORT=8080
DJANGO_ALLOWED_HOSTS=your-domain.example
DJANGO_CSRF_TRUSTED_ORIGINS=https://your-domain.example
```


## 4. Start Doko

Build and start the application: `docker compose up -d --build`

Check that all containers are running: `docker compose ps`

The main containers should include:
```
doko-postgres
doko-redis
doko-web
doko-celery-worker
doko-celery-beat
doko-connector-hub
doko-nginx
```

## 5. Find the initial administrator credentials

The initial administrator account is created during the first installation by the web container.
To find the generated administrator credentials, check the web container logs: `docker compose logs web`
Look for the lines related to the initial setup or superuser creation.

If you cannot find them, you can create a new one with: `docker exec -it doko-web python manage.py createsuperuser`

The initial setup only runs when Doko detects an empty installation. If the database already contains users or initial data, the setup is skipped on subsequent restarts.

After the first login, change the administrator password immediately and store the credentials securely.

## 6. Access Doko

Once the containers are running, open Doko in a browser: `http://127.0.0.1:8080`
If Doko is installed on a remote server, use the configured domain or server address instead.

## 7. Update Doko

To update an existing installation:

git pull
docker compose up -d --build

The application will apply database migrations automatically during startup.

Check the logs after updating: `docker compose logs --tail=100 web`

Before updating Doko or changing the production configuration, create a backup of the database and persistent volumes.
You can create the database backup via the UI, inside `Instance settings`.
