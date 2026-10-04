## Table of contents

- [Instance settings](#instance-settings)
- [Access control](#access-control)
- [Outbound proxy](#outbound-proxy)
- [Database backups](#database-backups)
- [Audit exports](#audit-exports)
- [Splunk HEC](#splunk-hec)
- [Deployment environment](#deployment-environment)
- [Troubleshooting](#troubleshooting)

## Instance settings

Instance settings control services and maintenance operations shared by the whole Doko installation.

The page contains:

- outbound proxy configuration
- database backup and restore
- audit export
- Splunk HTTP Event Collector export

Changes apply to new requests and jobs. Existing background jobs keep the configuration they already loaded until the next request or worker restart.

## Access control

The `settings.instance.manage` permission is required to open the page and use its API endpoints.

An account with `is_admin` enabled has all Doko administration permissions, including instance settings. A non-administrator can be granted only `settings.instance.manage` through a role when full administration access is not required.

Secrets entered on this page are encrypted before storage. Saved proxy passwords and Splunk HEC tokens are never returned by the settings API. Leave a secret field empty while saving to keep the stored value.

## Outbound proxy

The instance proxy is used for outbound HTTP requests made by:

- LLM providers
- SOAR providers and investigation templates
- connectors
- Splunk HEC audit forwarding
- configured HTTP callbacks

### Fields

| Field | Description |
| --- | --- |
| Enabled | Applies the proxy to outbound integrations when enabled. |
| Host | Proxy hostname or a hostname prefixed with `http://` or `https://`. |
| Port | Proxy port between `1` and `65535`. |
| Username | Optional proxy authentication username. |
| Password | Optional proxy authentication password. |

Enter the host and port separately. Do not place credentials, a port, a path, a query or a fragment in the Host field.

Valid examples:

```text
proxy.example.net
```

```text
http://proxy.example.net
```

```text
https://proxy.example.net
```

The selected proxy scheme describes the connection from Doko to the proxy. Both HTTP and HTTPS destination URLs use the configured proxy.

### Verification

After saving the proxy, test an integration that has a dedicated connection test, such as an LLM provider, a SOAR provider or Splunk HEC.

If authentication fails, verify the username and enter the password again. A blank password field preserves the existing password; it does not clear it.

## Database backups

### Create and download

Select **Create backup** to create a PostgreSQL custom-format backup. The most recent backup can be downloaded from the same page.

Generated files are stored in `/app/media/backups` by default, which belongs to the persistent media volume. `DOKO_BACKUP_DIR` can select another container path when the deployment mounts persistent storage there.

Keep downloaded backups outside the Doko host and protect them according to the sensitivity of the stored data.

### Restore

Restore accepts PostgreSQL custom backup files with a `.dump` or `.backup` extension.

Restoring a backup replaces the current database state. It does not merge records. Create a current backup first and verify that the selected file belongs to the intended Doko installation.

Application requests may be temporarily unavailable while the restore runs. Restart the application services after a restore if a worker still holds old database state.

Doko validates the archive before changing data, writes and verifies a recovery backup, and rejects concurrent restores. Schema replacement and data restoration run in one PostgreSQL transaction: an SQL error rolls back the changes instead of leaving an empty database. The recovery file remains in the backup directory even when restoring an older database removes its entry from the interface.

Only restore archives from a trusted source. A PostgreSQL backup contains executable SQL; format validation does not make an unknown archive safe. Schedule restoration during maintenance and stop incoming writes and background jobs first.

## Audit exports

Audit records contain action identifiers, object identifiers, result status, request information and sanitized metadata. Action payloads and record content are not copied into the object display field. Sensitive metadata keys, including passwords, tokens, prompts, messages, descriptions, IoCs and assets, are redacted.

The export function supports CSV and JSONL. Apply filters before exporting when only a specific period or result type is required.

Audit records can still contain account names, IP addresses, user agents and request paths because these fields identify who performed an action and how the request reached Doko. Handle exported files as access-controlled operational data.

## Splunk HEC

Splunk HEC forwards newly created audit records to a configured HTTP Event Collector endpoint through a background worker.

### Splunk preparation

Create or select an HTTP Event Collector token in Splunk and note:

- the collector endpoint
- the HEC token
- the optional index
- the source and sourcetype values

A typical endpoint is:

```text
https://splunk.example.net:8088/services/collector
```

HTTP endpoints are also accepted for services on a trusted internal network. Prefer HTTPS whenever traffic crosses an untrusted network.

### Doko fields

| Field | Description | Default |
| --- | --- | --- |
| Enabled | Queues new audit records for delivery. | Disabled |
| HEC endpoint | Full collector URL. | Empty |
| HEC token | Splunk HEC authentication token. | Empty |
| Index | Optional target index. | Splunk token default |
| Source | Value stored in the HEC event. | `doko:audit` |
| Sourcetype | Splunk source type. | `_json` |

Select **Test connection** before enabling the export. The test sends a small connectivity event and does not contain a case, alert, hunt, task or comment.

When enabled, each new audit event is sent asynchronously. Temporary delivery failures are retried by the background worker. The token is sent only in the `Authorization: Splunk ...` header and is not stored in audit metadata.

### Event structure

The HEC event contains:

- audit identifier and timestamp
- actor identifier and username
- action and object type
- object identifier
- success state and HTTP status
- request method, path and request identifier
- source IP, user agent and duration
- sanitized metadata
- `application: doko` and `event_kind: audit`

Record titles, comments, descriptions, prompts, outputs and integration credentials are not included as action content.

## Deployment environment

Deployment settings are read from the `.env` file referenced by Docker Compose.

`DJANGO_SECRET_KEY` must contain a unique value of at least 32 characters when debug mode is disabled. It is also used to derive the internal connector signing secret when `CONNECTOR_HMAC_SECRET` is not set.

`CONNECTOR_HMAC_SECRET` is optional. No manual calculation is needed: the web service and connector hub derive the same value automatically from `DJANGO_SECRET_KEY`.

### Authentication limits and incoming proxies

Login attempts are limited per account across the API and Django administration login. Password reset confirmation has a separate budget. Counters are shared through Redis. If Redis is unavailable, Doko logs a warning and falls back to per-process counters to keep authentication available; protection across workers is reduced until Redis recovers.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOKO_AUTH_LOGIN_PER_MINUTE` | `10` | Login attempts per account per minute. |
| `DOKO_AUTH_RESET_PER_MINUTE` | `5` | Reset confirmation attempts per identifier per minute. |
| `DOKO_AUTH_IP_PER_MINUTE` | `300` | Combined authentication attempts per client address per minute. |
| `DOKO_TRUSTED_PROXY_CIDRS` | Empty | Comma-separated IP addresses or CIDRs of trusted incoming proxies. |
| `DOKO_CHAT_PROMPTS_PER_MINUTE` | `20` | Interactive Catbot prompts per user in a rolling minute. |
| `DOKO_CHAT_MAX_CONCURRENT` | `4` | Queued or running interactive Catbot prompts per user, across conversations. |

These settings do not change the outbound proxy configured on this page. Without trusted proxy networks, authentication limits use the direct peer address and ignore `X-Forwarded-For`. Behind an Ingress or reverse proxy, configure only the actual trusted proxy networks and ensure the proxy sanitizes or appends the real client address. Do not trust every address (`0.0.0.0/0` or `::/0`). Size the combined address budget for deployments where many users share the same peer address. Authentication limits use fixed one-minute windows; HTTP 429 responses include a retry delay.

Interactive Catbot limits do not apply to automation rules or SOAR commands. Reading results, cancelling a request and copying a result into a comment draft do not consume prompt budget. No new database migration is required for these limits.

The initial administrator uses `DOKO_ADMIN_USERNAME` and `DOKO_ADMIN_EMAIL`. `DOKO_ADMIN_PASSWORD` is optional. When it is absent, Doko generates a strong password and prints it once in the web service logs under `DOKO INITIAL SUPERUSER CREATED`.

Start or update the complete stack with:

```bash
docker compose up -d --build
```

## Troubleshooting

### The proxy cannot be saved

Check that Host contains only a hostname with an optional `http://` or `https://` prefix. Put the port and credentials in their dedicated fields.

### A connection test fails through the proxy

Verify that the proxy can resolve and reach the destination. Check its allow rules, authentication method and certificate trust. Re-enter the proxy password when it may have changed.

### Splunk rejects the test event

Verify the full collector path, HEC token, token status and index permissions. Splunk normally accepts the event collector path `/services/collector` on its HEC port.

### Saved Splunk settings work in the test but audit events do not arrive

Confirm that the Celery worker and Redis services are running. The connection test runs immediately, while normal audit delivery uses the background queue.

```bash
docker compose ps
docker compose logs --tail=100 celery-worker
```

### The generated administrator password is not visible

The password is printed only when the first administrator is created. Search the first web service startup logs:

```bash
docker compose logs web
```

If an administrator already exists, Doko does not print or replace its password.
