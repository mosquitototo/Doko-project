## Table of contents

- [Connectors](#connectors)
- [Allowed domains](#allowed-domains)
- [Connector instances](#connector-instances)
- [Endpoints](#endpoints)
- [Template variables](#template-variables)
- [Using connectors](#using-connectors)
- [Connector results](#connector-results)
- [VirusTotal IP check example](#virustotal-ip-check-example)
- [VirusTotal domain check example](#virustotal-domain-check-example)
- [AbuseIPDB IP check example](#abuseipdb-ip-check-example)
- [API examples](#api-examples)
- [Troubleshooting](#troubleshooting)
- [Recommended patterns](#recommended-patterns)


## Connectors

Connectors define HTTP actions that can be launched from a case against selected IoCs, assets, or the case itself.

A connector is made of:

- allowed domains
- one connector instance
- one or more endpoints
- one optional secret

Connectors are useful for enrichment actions such as:

- checking an IP address reputation
- checking a domain reputation
- querying an external asset inventory
- querying a threat intelligence platform
- sending a case identifier to an external HTTP endpoint

A connector does not need a dedicated integration for each provider. It builds an HTTP request from the selected value and the configured endpoint.

---

## Allowed domains

Allowed domains define which external domains connectors are allowed to reach.

A domain must be added before an endpoint can use it.

Example:

```text
virustotal.com
```

This allows:

```text
www.virustotal.com
```

Example:

```text
abuseipdb.com
```

This allows:

```text
api.abuseipdb.com
```

### Domain

Domain name allowed for connector calls.

Examples:

```text
virustotal.com
```

```text
abuseipdb.com
```

```text
api.example.com
```

Recommendations:

- Add only domains that are required.
- Prefer the exact external provider domain when possible.
- Do not add broad domains unless they are needed.
- Do not include `https://`.
- Do not include a path.
- Do not include wildcards.

### Enabled

Defines whether the domain can currently be reached by connectors.

Disable a domain to temporarily block connector calls without deleting the configuration.

---

## Connector instances

A connector instance groups endpoints and stores one optional secret.

Use one instance for one external provider or one external environment.

Examples:

```text
VirusTotal
```

```text
AbuseIPDB
```

```text
Asset inventory - Production
```

### Name

Display name of the connector instance.

Example:

```text
VirusTotal
```

Use a short name that identifies the provider and environment.

### Description

Optional explanation of what the instance is used for.

Example:

```text
Threat intelligence lookups for IP addresses and domains.
```

### Secret

Secret used by the endpoints of the instance.

Examples:

```text
VirusTotal API key
```

```text
AbuseIPDB API key
```

The secret can be inserted into endpoint headers with:

```text
{{secret}}
```

When editing an existing instance, leave this field empty to keep the current secret.

### Enabled

Defines whether the instance can be used.

Disable an instance when the provider should not receive new requests.

---

## Endpoints

An endpoint defines one HTTP call that can be run from the connector instance.

An instance can contain several endpoints.

Examples:

```text
VirusTotal - IP check
VirusTotal - Domain check
AbuseIPDB - IP check
```

### Name

Stable endpoint name.

Example:

```text
ip_check
```

Use a short lowercase name without spaces.

### Label

Readable label shown to users.

Example:

```text
VirusTotal - IP check
```

Use a label that clearly explains what the endpoint checks.

### Method

HTTP method used by the endpoint.

Available values:

```text
GET
POST
PUT
PATCH
DELETE
```

Most enrichment connectors should use:

```text
GET
```

Use another method only when the remote provider expects it.

### Timeout, ms

Maximum time allowed for the endpoint call.

Allowed range:

```text
1000 to 60000
```

Recommended values:

```text
8000
```

```text
15000
```

Use a higher value only when the external provider is known to be slow.

### Base URL

Base HTTPS URL of the remote provider.

Examples:

```text
https://www.virustotal.com/api/v3/
```

```text
https://api.abuseipdb.com/api/v2/
```

Rules:

- Use HTTPS.
- The domain must be allowed in the allowed domains section.
- Do not include credentials in the URL.
- Keep the stable provider prefix here.
- Put the target-specific part in the path template.

### Path template

Path appended to the base URL.

The path can use runtime variables.

Example:

```text
ip_addresses/{{value}}
```

Example with query parameters:

```text
check?ipAddress={{value}}&maxAgeInDays=90&verbose=true
```

The final URL is built from:

```text
Base URL + Path template
```

Example:

```text
https://www.virustotal.com/api/v3/ + ip_addresses/8.8.8.8
```

Final URL:

```text
https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8
```

### Headers

JSON object containing HTTP headers.

Example:

```json
{
  "accept": "application/json",
  "x-apikey": "{{secret}}"
}
```

The value `{{secret}}` is replaced by the instance secret when the connector runs.

Recommendations:

- Always include `accept: application/json` when the remote provider returns JSON.
- Use `{{secret}}` instead of pasting the API key directly into headers.
- Do not include unnecessary headers.
- Do not include browser-only or transport headers.

Headers such as `host`, `content-length`, `transfer-encoding`, `connection`, `proxy-authorization`, `proxy-authenticate`, and `upgrade` should not be used.

### Enabled

Defines whether the endpoint can be used.

Disable an endpoint when the remote API changes, the API key is unavailable, or the action should no longer be launched.

---

## Template variables

Endpoint URLs and headers can use runtime variables.

### `{{value}}`

Selected value.

Examples:

```text
8.8.8.8
```

```text
evil.example
```

```text
workstation-01
```

Use this for the value that must be checked by the remote provider.

### `{{key}}`

Selected item field or type.

Examples:

```text
ip
```

```text
domain
```

```text
hostname
```

Use this when the external provider needs to know what kind of value is being sent.

### `{{case_id}}`

Identifier of the case from which the connector is launched.

Use this when the remote endpoint needs to know which case triggered the lookup.

### `{{secret}}`

Secret stored on the connector instance.

Use this in headers.

Examples:

```json
{
  "x-apikey": "{{secret}}"
}
```

```json
{
  "Key": "{{secret}}"
}
```

```json
{
  "Authorization": "Bearer {{secret}}"
}
```

---

## Using connectors

A connector is launched from a case.

The connector can target:

- one selected IoC
- several selected IoCs
- one selected asset
- several selected assets
- the case itself

When several targets are selected, Doko creates one request per target.

Example selected IoCs:

```json
[
  { "key": "ip", "value": "8.8.8.8" },
  { "key": "ip", "value": "1.1.1.1" }
]
```

If the endpoint path is:

```text
ip_addresses/{{value}}
```

Doko calls:

```text
ip_addresses/8.8.8.8
ip_addresses/1.1.1.1
```

Each result is stored separately.

### IoC target

Use this when the selected item is an indicator.

Examples:

```json
{ "key": "ip", "value": "8.8.8.8" }
```

```json
{ "key": "domain", "value": "example.com" }
```

### Asset target

Use this when the selected item is an asset.

Examples:

```json
{ "key": "hostname", "value": "workstation-01" }
```

```json
{ "key": "user", "value": "alice" }
```

### Case target

Use this when the external endpoint should receive the case identifier.

The target value is the case id.

---

## Connector results

Each connector execution creates connector results on the case.

A result contains:

- case id
- connector instance id
- endpoint id
- target type
- target key
- target value
- request payload
- response payload
- status
- error
- creation date

Status values:

```text
success
error
```

Use the response payload to inspect the provider result.

Use the error field when the connector call failed.

---

## VirusTotal IP check example

This example checks IP addresses with VirusTotal API v3.

The VirusTotal API v3 IP report endpoint is:

```text
https://www.virustotal.com/api/v3/ip_addresses/{ip}
```

VirusTotal expects the API key in the `x-apikey` header.

### Allowed domain

Add:

```text
virustotal.com
```

### Connector instance

| Field | Value |
|---|---|
| Name | `VirusTotal` |
| Description | `VirusTotal threat intelligence lookups.` |
| Secret | VirusTotal API key |
| Enabled | enabled |

### Endpoint

| Field | Value |
|---|---|
| Name | `virustotal_ip_check` |
| Label | `VirusTotal - IP check` |
| Method | `GET` |
| Timeout, ms | `15000` |
| Base URL | `https://www.virustotal.com/api/v3/` |
| Path template | `ip_addresses/{{value}}` |
| Enabled | enabled |

### Headers

```json
{
  "accept": "application/json",
  "x-apikey": "{{secret}}"
}
```

### Expected target

Use this endpoint on IoCs where the key is:

```text
ip
```

Example target:

```json
{ "key": "ip", "value": "8.8.8.8" }
```

### Meaning of each variable

| Variable | Meaning | Example value |
|---|---|---|
| `{{value}}` | IP address selected in the case | `8.8.8.8` |
| `{{key}}` | Selected item key | `ip` |
| `{{case_id}}` | Case identifier | `8c6f...` |
| `{{secret}}` | VirusTotal API key stored on the instance | hidden |

### Result

The response payload contains the VirusTotal IP object.

Typical useful fields are inside:

```text
data.attributes
```

Useful values may include reputation, last analysis statistics, country, ASN, and network information depending on the VirusTotal response.

---

## VirusTotal domain check example

This example checks domains with VirusTotal API v3.

The VirusTotal API v3 domain report endpoint is:

```text
https://www.virustotal.com/api/v3/domains/{domain}
```

VirusTotal expects the API key in the `x-apikey` header.

### Allowed domain

Reuse the existing allowed domain:

```text
virustotal.com
```

### Connector instance

Reuse the existing instance:

```text
VirusTotal
```

### Endpoint

| Field | Value |
|---|---|
| Name | `virustotal_domain_check` |
| Label | `VirusTotal - Domain check` |
| Method | `GET` |
| Timeout, ms | `15000` |
| Base URL | `https://www.virustotal.com/api/v3/` |
| Path template | `domains/{{value}}` |
| Enabled | enabled |

### Headers

```json
{
  "accept": "application/json",
  "x-apikey": "{{secret}}"
}
```

### Expected target

Use this endpoint on IoCs where the key is:

```text
domain
```

Example target:

```json
{ "key": "domain", "value": "example.com" }
```

### Meaning of each variable

| Variable | Meaning | Example value |
|---|---|---|
| `{{value}}` | Domain selected in the case | `example.com` |
| `{{key}}` | Selected item key | `domain` |
| `{{case_id}}` | Case identifier | `8c6f...` |
| `{{secret}}` | VirusTotal API key stored on the instance | hidden |

### Result

The response payload contains the VirusTotal domain object.

Typical useful fields are inside:

```text
data.attributes
```

Useful values may include reputation, last analysis statistics, categories, registrar, and DNS-related information depending on the VirusTotal response.

---

## AbuseIPDB IP check example

This example checks IP addresses with AbuseIPDB.

The AbuseIPDB check endpoint is:

```text
https://api.abuseipdb.com/api/v2/check
```

AbuseIPDB expects:

- an IP address in the `ipAddress` query parameter
- the API key in the `Key` header
- `Accept: application/json`

### Allowed domain

Add:

```text
abuseipdb.com
```

### Connector instance

| Field | Value |
|---|---|
| Name | `AbuseIPDB` |
| Description | `IP reputation checks with AbuseIPDB.` |
| Secret | AbuseIPDB API key |
| Enabled | enabled |

### Endpoint

| Field | Value |
|---|---|
| Name | `abuseipdb_ip_check` |
| Label | `AbuseIPDB - IP check` |
| Method | `GET` |
| Timeout, ms | `15000` |
| Base URL | `https://api.abuseipdb.com/api/v2/` |
| Path template | `check?ipAddress={{value}}&maxAgeInDays=90&verbose=true` |
| Enabled | enabled |

### Headers

```json
{
  "accept": "application/json",
  "Key": "{{secret}}"
}
```

### Expected target

Use this endpoint on IoCs where the key is:

```text
ip
```

Example target:

```json
{ "key": "ip", "value": "8.8.8.8" }
```

### Meaning of each variable

| Variable | Meaning | Example value |
|---|---|---|
| `{{value}}` | IP address selected in the case | `8.8.8.8` |
| `{{key}}` | Selected item key | `ip` |
| `{{case_id}}` | Case identifier | `8c6f...` |
| `{{secret}}` | AbuseIPDB API key stored on the instance | hidden |

### Query parameters

| Parameter | Meaning | Example value |
|---|---|---|
| `ipAddress` | IP address to check | `8.8.8.8` |
| `maxAgeInDays` | Only include reports from the last selected number of days | `90` |
| `verbose` | Ask for a more detailed response | `true` |

### Result

The response payload contains the AbuseIPDB result.

Typical useful fields are inside:

```text
data
```

Useful values may include abuse confidence score, country code, ISP, usage type, total reports, and report details depending on the response.

---

## API examples

Connectors can also be managed and launched through the API.

Replace:

```text
http://YOUR_DOKO
```

with the URL of the Doko instance.

Replace:

```text
YOUR_TOKEN
```

with a valid API token.

### List allowed domains

```bash
curl "http://YOUR_DOKO/api/connectors/allowlist/" \
  -H "Authorization: Token YOUR_TOKEN"
```

### Add an allowed domain

```bash
curl -X POST "http://YOUR_DOKO/api/connectors/allowlist/" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "virustotal.com",
    "is_enabled": true
  }'
```

### Create a connector instance

```bash
curl -X POST "http://YOUR_DOKO/api/connectors/instances/" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VirusTotal",
    "description": "VirusTotal threat intelligence lookups.",
    "connector_type": "http",
    "is_enabled": true,
    "config": {},
    "secret": "VIRUSTOTAL_API_KEY"
  }'
```

### Add the VirusTotal IP endpoint

```bash
curl -X POST "http://YOUR_DOKO/api/connectors/instances/CONNECTOR_INSTANCE_ID/endpoints/" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "virustotal_ip_check",
    "label": "VirusTotal - IP check",
    "target_type": "case",
    "method": "GET",
    "base_url": "https://www.virustotal.com/api/v3/",
    "path_template": "ip_addresses/{{value}}",
    "headers": {
      "accept": "application/json",
      "x-apikey": "{{secret}}"
    },
    "timeout_ms": 15000,
    "is_enabled": true
  }'
```

### Run a connector against one IP IoC

```bash
curl -X POST "http://YOUR_DOKO/api/connectors/run/" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "ENDPOINT_ID",
    "target_type": "ioc",
    "targets": [
      { "key": "ip", "value": "8.8.8.8" }
    ],
    "context": {
      "source": "manual"
    }
  }'
```

### Run a connector against several IP IoCs

```bash
curl -X POST "http://YOUR_DOKO/api/connectors/run/" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "ENDPOINT_ID",
    "target_type": "ioc",
    "targets": [
      { "key": "ip", "value": "8.8.8.8" },
      { "key": "ip", "value": "1.1.1.1" }
    ],
    "context": {
      "source": "manual"
    }
  }'
```

### List connector results for a case

```bash
curl "http://YOUR_DOKO/api/connectors/results/?case_id=CASE_UUID" \
  -H "Authorization: Token YOUR_TOKEN"
```

### Python example: run VirusTotal IP check

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
CASE_ID = "CASE_UUID"
CONNECTOR_INSTANCE_ID = "CONNECTOR_INSTANCE_ID"
ENDPOINT_ID = "ENDPOINT_ID"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

payload = {
    "case_id": CASE_ID,
    "connector_instance_id": CONNECTOR_INSTANCE_ID,
    "endpoint_id": ENDPOINT_ID,
    "target_type": "ioc",
    "targets": [
        {"key": "ip", "value": "8.8.8.8"},
    ],
    "context": {
        "source": "manual",
    },
}

response = requests.post(
    f"{DOKO_URL}/api/connectors/run/",
    headers=headers,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

---

## Troubleshooting

### The endpoint cannot be saved

Check:

- The base URL uses HTTPS.
- The domain is present in allowed domains.
- The path template is not empty.
- The timeout is between `1000` and `60000` ms.
- Headers are valid JSON.

### Domain not allowed

Check:

- The domain was added in the allowed domains section.
- The domain is enabled.
- The base URL hostname matches the allowed domain or one of its subdomains.

Example:

```text
Allowed domain: virustotal.com
Base URL: https://www.virustotal.com/api/v3/
```

This is valid because `www.virustotal.com` is a subdomain of `virustotal.com`.

### Authentication fails

Check:

- The instance secret is configured.
- The header name matches the provider documentation.
- The header value uses `{{secret}}`.
- The API key is still valid.

VirusTotal example:

```json
{
  "x-apikey": "{{secret}}"
}
```

AbuseIPDB example:

```json
{
  "Key": "{{secret}}"
}
```

### The connector runs but returns an error

Check:

- The selected target value is valid for the provider.
- The path template matches the provider endpoint.
- The provider rate limit has not been reached.
- The API key has access to the requested endpoint.
- The response payload and error field in the connector result.

### Multiple selected values do not work as expected

Check:

- Each selected item has a `key` and a `value`.
- The path template uses `{{value}}`.
- The endpoint supports the selected item type.

Example target list:

```json
[
  { "key": "ip", "value": "8.8.8.8" },
  { "key": "ip", "value": "1.1.1.1" }
]
```

### POST endpoints do not receive a JSON body

The connector configuration builds requests from URL, method, headers, and target values.

Use query parameters or path parameters for providers that can work with URL-based input.

For providers that require a custom JSON body, use an intermediate webhook or workflow that accepts URL/path/query input and builds the provider-specific request.

---

## Recommended patterns

### Use one instance per provider

Good pattern:

```text
Instance: VirusTotal
Endpoint 1: VirusTotal - IP check
Endpoint 2: VirusTotal - Domain check
```

Avoid creating one instance for every endpoint when the same API key is used.

### Use clear endpoint labels

Good labels:

```text
VirusTotal - IP check
VirusTotal - Domain check
AbuseIPDB - IP check
```

Avoid vague labels such as:

```text
Check
Lookup
API call
```

### Use root domains in the allowlist

Good pattern:

```text
virustotal.com
abuseipdb.com
```

This allows the required API subdomains while keeping the allowlist readable.

### Keep secrets on the instance

Store the provider API key in the connector instance secret.

Use `{{secret}}` in endpoint headers.

Do not paste API keys directly into endpoint headers.

### Use one endpoint per target type

Good pattern:

```text
VirusTotal - IP check
VirusTotal - Domain check
```

Avoid one endpoint that tries to handle several unrelated API paths.

### Start with one test value

Before using a connector on several IoCs or assets, test it with one value.

Example:

```text
8.8.8.8
```

After confirming the response format, use it with multiple selected values.

### Keep responses structured

Prefer providers and workflows that return JSON.

Structured results are easier to review and reuse in the case.
