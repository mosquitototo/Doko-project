## Table of contents

- [Basics](#basics)
- [Authentication](#authentication)
- [Token identity and permissions](#token-identity-and-permissions)
- [Reference data](#reference-data)
- [Alerts](#alerts)
- [Cases](#cases)
- [Hunts](#hunts)
- [Tasks](#tasks)
- [Global search](#global-search)
- [Connectors](#connectors)
- [Catbot](#catbot)
- [Errors](#errors)

## Basics

The API uses JSON for most requests and responses.

The examples use this placeholder base URL:

```text
https://YOUR_DOKO_INSTANCE
```

Replace it with the actual URL of the Doko instance.

Most requests use this header:

```http
Authorization: Token YOUR_API_TOKEN
```

For JSON requests, also include:

```http
Content-Type: application/json
```

For file uploads, do not set `Content-Type` manually. Let the client set the multipart boundary.

Common placeholders used in the examples:

```text
YOUR_API_TOKEN
CUSTOMER_UUID
USER_ID
ALERT_UUID
CASE_UUID
HUNT_UUID
TASK_UUID
COMMENT_UUID
ATTACHMENT_UUID
TEMPLATE_UUID
WORKBOOK_ITEM_ID
CONNECTOR_INSTANCE_ID
CONNECTOR_ENDPOINT_ID
```

Dates are expected in ISO 8601 format when a date and time is required:

```text
2026-05-19T10:30:00Z
```

_______________________________________________________________________

## Authentication

### Create an API token from credentials

Use this when a script needs to obtain a token with a username or email and password.

```bash
curl -X POST "https://YOUR_DOKO_INSTANCE/api/auth/token/" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "analyst1",
    "password": "PASSWORD"
  }'
```

Python example:

```python
import requests

base_url = "https://YOUR_DOKO_INSTANCE"

response = requests.post(
    f"{base_url}/api/auth/token/",
    json={"username": "analyst1", "password": "PASSWORD"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Typical response:

```json
{
  "token": "API_TOKEN_VALUE",
  "expiry": "2026-05-20T12:00:00Z"
}
```

### Store a token in scripts

Shell examples in this guide use:

```bash
DOKO_URL="https://YOUR_DOKO_INSTANCE"
DOKO_TOKEN="YOUR_API_TOKEN"
```

Python examples in this guide use:

```python
import requests

DOKO_URL = "https://YOUR_DOKO_INSTANCE"
DOKO_TOKEN = "YOUR_API_TOKEN"
HEADERS = {"Authorization": f"Token {DOKO_TOKEN}"}
JSON_HEADERS = {**HEADERS, "Content-Type": "application/json"}
```

_______________________________________________________________________

## Token identity and permissions

### Check which account owns the token

```bash
curl "$DOKO_URL/api/me/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

DOKO_URL = "https://YOUR_DOKO_INSTANCE"
DOKO_TOKEN = "YOUR_API_TOKEN"

response = requests.get(
    f"{DOKO_URL}/api/me/",
    headers={"Authorization": f"Token {DOKO_TOKEN}"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Typical response:

```json
{
  "id": 12,
  "username": "analyst1",
  "email": "analyst1@example.com",
  "is_staff": false,
  "timezone": "Europe/Paris",
  "avatar_url": null,
  "permissions": ["case.view", "case.add", "alert.view"],
  "rbac_debug": {
    "direct_roles": ["SOC Analyst"]
  }
}
```

Use this endpoint before running automation scripts. It confirms the account, the permissions and the customer scope attached to the token.

### Common permission behavior

A token inherits the permissions of its account.

Objects linked to a customer outside the token scope may return `403 Forbidden` or `404 Not Found`.

Actions that create or change data require the corresponding add, update, manage or delete permission.

_______________________________________________________________________

## Reference data

### List accessible customers

```bash
curl "$DOKO_URL/api/settings/customers/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/settings/customers/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

The returned customer `id` values can be used as `customer` in alerts, cases and hunts, and as `customer_ids_write` in tasks.

### List assignable users

```bash
curl "$DOKO_URL/api/users-lite/?q=analyst" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/users-lite/",
    headers=HEADERS,
    params={"q": "analyst"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Use the returned numeric `id` as `owner`, `owner_id` or `reviewer_ids` depending on the endpoint.

### List severities

```bash
curl "$DOKO_URL/api/settings/data-models/severities/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/settings/data-models/severities/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Use the `code` value when setting `severity`.

### List classifications

```bash
curl "$DOKO_URL/api/settings/data-models/classifications/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/settings/data-models/classifications/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Use the `code` value when setting `classification`.

_______________________________________________________________________

## Alerts

### Alert fields

Common fields:

```json
{
  "title": "Suspicious DNS activity",
  "description": "Unusual DNS activity detected",
  "classification": "generic",
  "severity": "high",
  "status": "open",
  "outcome": "unknown",
  "source": "SIEM",
  "customer": "CUSTOMER_UUID",
  "owner": 12,
  "iocs": [
    {"field": "domain", "value": "bad.example", "status": "new"}
  ],
  "assets": [
    {"field": "hostname", "value": "srv-dns-01", "status": "observed"}
  ]
}
```

Common alert statuses:

```text
open
merged
closed
```

Common outcomes:

```text
true_positive_with_impact
true_positive_without_impact
false_positive_technical
false_positive
legitimate
not_applicable
unknown
```

### List alerts

```bash
curl "$DOKO_URL/api/alerts/?status=open&severity=high&customer=CUSTOMER_UUID" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/alerts/",
    headers=HEADERS,
    params={"status": "open", "severity": "high", "customer": "CUSTOMER_UUID"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Useful filters:

```text
search
status
severity
classification
outcome
owner
customer
customer_id
ordering
```

### Create an alert

```bash
curl -X POST "$DOKO_URL/api/alerts/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Suspicious DNS activity",
    "description": "Unusual DNS activity detected by SIEM",
    "classification": "generic",
    "severity": "high",
    "status": "open",
    "outcome": "unknown",
    "source": "SIEM",
    "customer": "CUSTOMER_UUID",
    "owner": 12,
    "iocs": [
      {"field": "domain", "value": "bad.example", "status": "new"}
    ],
    "assets": [
      {"field": "hostname", "value": "srv-dns-01", "status": "observed"}
    ]
  }'
```

Python example:

```python
import requests

payload = {
    "title": "Suspicious DNS activity",
    "description": "Unusual DNS activity detected by SIEM",
    "classification": "generic",
    "severity": "high",
    "status": "open",
    "outcome": "unknown",
    "source": "SIEM",
    "customer": "CUSTOMER_UUID",
    "owner": 12,
    "iocs": [{"field": "domain", "value": "bad.example", "status": "new"}],
    "assets": [{"field": "hostname", "value": "srv-dns-01", "status": "observed"}],
}

response = requests.post(
    f"{DOKO_URL}/api/alerts/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Python example with email exchange :
```python
import requests

email_body = """
<p>Hello,</p>
<p>Please open the attached invoice.</p>
<p>Regards,</p>
"""

payload = {
    "title": "Suspicious email reported",
    "description": "Suspicious email received by user@example.com",
    "classification": "generic",
    "severity": "high",
    "status": "open",
    "outcome": "unknown",
    "source": "SIEM",
    "customer": "CUSTOMER_UUID",
    "owner": 12,
    "iocs": [
        {"field": "domain", "value": "bad.example", "status": "new"},
        {"field": "email", "value": "attacker@bad.example", "status": "new"},
    ],
    "assets": [
        {"field": "hostname", "value": "srv-dns-01", "status": "observed"},
        {"field": "email_account", "value": "user@example.com", "status": "observed"},
    ],
    "raw": {
        "source_kind": "email",
        "source_ref": "siem:event:EVENT_ID_OR_UID",
        "case_exchanges": [
            {
                "external_id": "siem:event:EVENT_ID_OR_UID:message:<message-id@bad.example>",
                "direction": "inbound",
                "channel": "email",
                "subject": "Suspicious invoice",
                "body": email_body,
                "sender": "attacker@bad.example",
                "to": ["user@example.com"],
                "cc": [],
                "bcc": [],
                "message_id": "<message-id@bad.example>",
                "references": [],
                "raw": {
                    "headers": {
                        "return-path": "attacker@bad.example",
                        "from": "attacker@bad.example",
                        "to": "user@example.com",
                        "subject": "Suspicious invoice",
                        "message-id": "<message-id@bad.example>",
                    },
                    "siem_event_id": "EVENT_ID_OR_UID",
                },
            }
        ],
    },
}

response = requests.post(
    f"{DOKO_URL}/api/alerts/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Read an alert

```bash
curl "$DOKO_URL/api/alerts/ALERT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Modify an alert

Use `PATCH` to update only selected fields.

```bash
curl -X PATCH "$DOKO_URL/api/alerts/ALERT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": "CUSTOMER_UUID",
    "owner": 12,
    "classification": "generic",
    "status": "closed",
    "outcome": "false_positive",
    "description": "Closed after investigation. No malicious activity confirmed."
  }'
```

Python example:

```python
import requests

payload = {
    "customer": "CUSTOMER_UUID",
    "owner": 12,
    "classification": "generic",
    "status": "closed",
    "outcome": "false_positive",
    "description": "Closed after investigation. No malicious activity confirmed.",
}

response = requests.patch(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add, modify or delete alert IoCs

IoCs are replaced as a full list. To add, modify or delete one IoC, first read the alert, edit the list, then send the full new list.

Example replacing the IoC list:

```bash
curl -X PATCH "$DOKO_URL/api/alerts/ALERT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "iocs": [
      {"field": "domain", "value": "bad.example", "status": "confirmed"},
      {"field": "ip", "value": "203.0.113.10", "status": "new"}
    ]
  }'
```

Python example:

```python
import requests

alert_url = f"{DOKO_URL}/api/alerts/ALERT_UUID/"
alert = requests.get(alert_url, headers=HEADERS, timeout=30)
alert.raise_for_status()
data = alert.json()

iocs = data.get("iocs") or []
iocs = [ioc for ioc in iocs if ioc.get("value") != "old.example"]
iocs.append({"field": "domain", "value": "bad.example", "status": "confirmed"})

response = requests.patch(
    alert_url,
    headers=JSON_HEADERS,
    json={"iocs": iocs},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add, modify or delete alert assets

Assets are replaced as a full list.

```bash
curl -X PATCH "$DOKO_URL/api/alerts/ALERT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assets": [
      {"field": "hostname", "value": "srv-dns-01", "status": "confirmed"},
      {"field": "user", "value": "jdoe", "status": "observed"}
    ]
  }'
```

Python example:

```python
import requests

alert_url = f"{DOKO_URL}/api/alerts/ALERT_UUID/"
alert = requests.get(alert_url, headers=HEADERS, timeout=30)
alert.raise_for_status()
data = alert.json()

assets = data.get("assets") or []
assets = [asset for asset in assets if asset.get("value") != "old-host"]
assets.append({"field": "hostname", "value": "srv-dns-01", "status": "confirmed"})

response = requests.patch(
    alert_url,
    headers=JSON_HEADERS,
    json={"assets": assets},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Delete an alert

Deletion is soft deletion.

```bash
curl -X POST "$DOKO_URL/api/alerts/ALERT_UUID/delete/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/delete/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add a comment to an alert

```bash
curl -X POST "$DOKO_URL/api/alerts/ALERT_UUID/comments/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "<p>Initial triage completed.</p>"
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/comments/",
    headers=JSON_HEADERS,
    json={"text": "<p>Initial triage completed.</p>"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update or delete an alert comment

```bash
curl -X PATCH "$DOKO_URL/api/alert-comments/COMMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "<p>Updated triage note.</p>"}'
```

```bash
curl -X DELETE "$DOKO_URL/api/alert-comments/COMMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

comment_url = f"{DOKO_URL}/api/alert-comments/COMMENT_UUID/"

updated = requests.patch(
    comment_url,
    headers=JSON_HEADERS,
    json={"text": "<p>Updated triage note.</p>"},
    timeout=30,
)
updated.raise_for_status()

removed = requests.delete(comment_url, headers=HEADERS, timeout=30)
removed.raise_for_status()
```

### Escalate an alert into a new case

```bash
curl -X POST "$DOKO_URL/api/alerts/ALERT_UUID/escalate/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Escalate and merge several alerts into the new case:

```bash
curl -X POST "$DOKO_URL/api/alerts/ALERT_UUID/escalate/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "alert_ids": ["OTHER_ALERT_UUID_1", "OTHER_ALERT_UUID_2"]
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/escalate/",
    headers=JSON_HEADERS,
    json={"alert_ids": ["OTHER_ALERT_UUID_1", "OTHER_ALERT_UUID_2"]},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Link an alert to an existing case

```bash
curl -X POST "$DOKO_URL/api/alerts/ALERT_UUID/link/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID"
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/link/",
    headers=JSON_HEADERS,
    json={"case_id": "CASE_UUID"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Unlink an alert from a case

```bash
curl -X POST "$DOKO_URL/api/alerts/ALERT_UUID/unmerge/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/alerts/ALERT_UUID/unmerge/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

_______________________________________________________________________

## Cases

The case endpoints use `/api/events/`.

### Case fields

Common fields:

```json
{
  "title": "Suspicious outbound traffic",
  "description": "Investigation in progress",
  "status": "open",
  "classification": "generic",
  "severity": "high",
  "outcome": "unknown",
  "customer": "CUSTOMER_UUID",
  "owner_id": 12,
  "iocs": [
    {"field": "ip", "value": "203.0.113.10", "status": "new"}
  ],
  "assets": [
    {"field": "hostname", "value": "srv-app-01", "status": "observed"}
  ]
}
```

Common case statuses:

```text
open
in_progress
resolved
closed
archived
```

### List cases

```bash
curl "$DOKO_URL/api/events/?status=open&severity=high&include_archived=0" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/events/",
    headers=HEADERS,
    params={"status": "open", "severity": "high", "include_archived": "0"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Useful filters:

```text
search
status
severity
classification
outcome
owner
customer
include_archived
archived_only
ordering
```

### Create a case

```bash
curl -X POST "$DOKO_URL/api/events/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Suspicious outbound traffic",
    "description": "Investigation in progress",
    "status": "open",
    "classification": "generic",
    "severity": "high",
    "outcome": "unknown",
    "customer": "CUSTOMER_UUID",
    "owner_id": 12,
    "iocs": [
      {"field": "ip", "value": "203.0.113.10", "status": "new"}
    ],
    "assets": [
      {"field": "hostname", "value": "srv-app-01", "status": "observed"}
    ]
  }'
```

Python example:

```python
import requests

payload = {
    "title": "Suspicious outbound traffic",
    "description": "Investigation in progress",
    "status": "open",
    "classification": "generic",
    "severity": "high",
    "outcome": "unknown",
    "customer": "CUSTOMER_UUID",
    "owner_id": 12,
    "iocs": [{"field": "ip", "value": "203.0.113.10", "status": "new"}],
    "assets": [{"field": "hostname", "value": "srv-app-01", "status": "observed"}],
}

response = requests.post(
    f"{DOKO_URL}/api/events/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Read a case

```bash
curl "$DOKO_URL/api/events/CASE_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/events/CASE_UUID/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Modify a case

```bash
curl -X PATCH "$DOKO_URL/api/events/CASE_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": "CUSTOMER_UUID",
    "owner_id": 12,
    "status": "in_progress",
    "severity": "critical",
    "classification": "generic",
    "outcome": "unknown",
    "description": "Investigation updated by automation."
  }'
```

Python example:

```python
import requests

payload = {
    "customer": "CUSTOMER_UUID",
    "owner_id": 12,
    "status": "in_progress",
    "severity": "critical",
    "classification": "generic",
    "outcome": "unknown",
    "description": "Investigation updated by automation.",
}

response = requests.patch(
    f"{DOKO_URL}/api/events/CASE_UUID/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add, modify or delete case IoCs

IoCs are replaced as a full list.

```bash
curl -X PATCH "$DOKO_URL/api/events/CASE_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "iocs": [
      {"field": "ip", "value": "203.0.113.10", "status": "confirmed"},
      {"field": "domain", "value": "bad.example", "status": "new"}
    ]
  }'
```

Python example:

```python
import requests

case_url = f"{DOKO_URL}/api/events/CASE_UUID/"
case_response = requests.get(case_url, headers=HEADERS, timeout=30)
case_response.raise_for_status()
data = case_response.json()

iocs = data.get("iocs") or []
iocs = [ioc for ioc in iocs if ioc.get("value") != "old.example"]
iocs.append({"field": "domain", "value": "bad.example", "status": "new"})

response = requests.patch(
    case_url,
    headers=JSON_HEADERS,
    json={"iocs": iocs},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add, modify or delete case assets

Assets are replaced as a full list.

```bash
curl -X PATCH "$DOKO_URL/api/events/CASE_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assets": [
      {"field": "hostname", "value": "srv-app-01", "status": "confirmed"},
      {"field": "user", "value": "jdoe", "status": "observed"}
    ]
  }'
```

Python example:

```python
import requests

case_url = f"{DOKO_URL}/api/events/CASE_UUID/"
case_response = requests.get(case_url, headers=HEADERS, timeout=30)
case_response.raise_for_status()
data = case_response.json()

assets = data.get("assets") or []
assets = [asset for asset in assets if asset.get("value") != "old-host"]
assets.append({"field": "hostname", "value": "srv-app-01", "status": "confirmed"})

response = requests.patch(
    case_url,
    headers=JSON_HEADERS,
    json={"assets": assets},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add a comment to a case

```bash
curl -X POST "$DOKO_URL/api/events/CASE_UUID/comments/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "<p>Initial analysis completed.</p>"
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/events/CASE_UUID/comments/",
    headers=JSON_HEADERS,
    json={"text": "<p>Initial analysis completed.</p>"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update or delete a case comment

```bash
curl -X PATCH "$DOKO_URL/api/comments/COMMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "<p>Updated case note.</p>"}'
```

```bash
curl -X DELETE "$DOKO_URL/api/comments/COMMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

comment_url = f"{DOKO_URL}/api/comments/COMMENT_UUID/"

updated = requests.patch(
    comment_url,
    headers=JSON_HEADERS,
    json={"text": "<p>Updated case note.</p>"},
    timeout=30,
)
updated.raise_for_status()

removed = requests.delete(comment_url, headers=HEADERS, timeout=30)
removed.raise_for_status()
```

### List case attachments

```bash
curl "$DOKO_URL/api/events/CASE_UUID/attachments/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/events/CASE_UUID/attachments/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add a case attachment

```bash
curl -X POST "$DOKO_URL/api/events/CASE_UUID/attachments/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -F "file=@/path/to/evidence.pdf"
```

Python example:

```python
import requests

with open("/path/to/evidence.pdf", "rb") as file_handle:
    response = requests.post(
        f"{DOKO_URL}/api/events/CASE_UUID/attachments/",
        headers=HEADERS,
        files={"file": ("evidence.pdf", file_handle)},
        timeout=60,
    )
response.raise_for_status()
print(response.json())
```

### Delete a case attachment

```bash
curl -X DELETE "$DOKO_URL/api/attachments/ATTACHMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.delete(
    f"{DOKO_URL}/api/attachments/ATTACHMENT_UUID/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
```

### Create an incident timeline event

```bash
curl -X POST "$DOKO_URL/api/cases/CASE_UUID/incident-timeline/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "occurred_at": "2026-05-19T10:30:00Z",
    "title": "Execution observed",
    "details": "A suspicious process was started on srv-app-01.",
    "kind": "execution",
    "severity": "high",
    "source": "manual"
  }'
```

Python example:

```python
import requests

payload = {
    "occurred_at": "2026-05-19T10:30:00Z",
    "title": "Execution observed",
    "details": "A suspicious process was started on srv-app-01.",
    "kind": "execution",
    "severity": "high",
    "source": "manual",
}

response = requests.post(
    f"{DOKO_URL}/api/cases/CASE_UUID/incident-timeline/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update or delete an incident timeline event

```bash
curl -X PATCH "$DOKO_URL/api/incident-timeline-items/INCIDENT_EVENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Execution confirmed",
    "severity": "critical"
  }'
```

```bash
curl -X DELETE "$DOKO_URL/api/incident-timeline-items/INCIDENT_EVENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

item_url = f"{DOKO_URL}/api/incident-timeline-items/INCIDENT_EVENT_UUID/"

updated = requests.patch(
    item_url,
    headers=JSON_HEADERS,
    json={"title": "Execution confirmed", "severity": "critical"},
    timeout=30,
)
updated.raise_for_status()

removed = requests.delete(item_url, headers=HEADERS, timeout=30)
removed.raise_for_status()
```

### Archive and unarchive a case

```bash
curl -X POST "$DOKO_URL/api/events/CASE_UUID/archive/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

```bash
curl -X POST "$DOKO_URL/api/events/CASE_UUID/unarchive/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

archive = requests.post(
    f"{DOKO_URL}/api/events/CASE_UUID/archive/",
    headers=HEADERS,
    timeout=30,
)
archive.raise_for_status()

unarchive = requests.post(
    f"{DOKO_URL}/api/events/CASE_UUID/unarchive/",
    headers=HEADERS,
    timeout=30,
)
unarchive.raise_for_status()
```

### List case exchanges

```bash
curl "$DOKO_URL/api/cases/CASE_UUID/exchanges/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/cases/CASE_UUID/exchanges/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add an exchange message

```bash
curl -X POST "$DOKO_URL/api/cases/CASE_UUID/exchanges/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "direction": "outbound",
    "channel": "email",
    "subject": "Request for information",
    "body": "<p>Please confirm the following points.</p>",
    "sender": "soc@example.com",
    "to": ["customer@example.com"],
    "cc": ["manager@example.com"],
    "bcc": [],
    "message_id": "msg-20260519-001",
    "references": ["thread-12345"],
    "raw": {
      "source": "api",
      "category": "manual_message"
    }
  }'
```

Python example:

```python
import requests

payload = {
    "direction": "outbound",
    "channel": "email",
    "subject": "Request for information",
    "body": "<p>Please confirm the following points.</p>",
    "sender": "soc@example.com",
    "to": ["customer@example.com"],
    "cc": ["manager@example.com"],
    "bcc": [],
    "message_id": "msg-20260519-001",
    "references": ["thread-12345"],
    "raw": {"source": "api", "category": "manual_message"},
}

response = requests.post(
    f"{DOKO_URL}/api/cases/CASE_UUID/exchanges/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Fields `to`, `cc`, `bcc` and `references` must be lists.

The `raw` object is the right place to store metadata useful to scripts, such as a source name, external ticket id, message category, correlation id or original payload reference.

### Send an exchange message

Use this endpoint when the message should be created and sent through the configured send action.

```bash
curl -X POST "$DOKO_URL/api/cases/CASE_UUID/exchanges/send/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "email",
    "subject": "Request for information",
    "body": "<p>Please confirm the following points.</p>",
    "sender": "soc@example.com",
    "to": ["customer@example.com"],
    "cc": [],
    "bcc": [],
    "message_id": "",
    "references": [],
    "raw": {
      "source": "api",
      "external_reference": "EXT-12345"
    }
  }'
```

Python example:

```python
import requests

payload = {
    "channel": "email",
    "subject": "Request for information",
    "body": "<p>Please confirm the following points.</p>",
    "sender": "soc@example.com",
    "to": ["customer@example.com"],
    "cc": [],
    "bcc": [],
    "message_id": "",
    "references": [],
    "raw": {"source": "api", "external_reference": "EXT-12345"},
}

response = requests.post(
    f"{DOKO_URL}/api/cases/CASE_UUID/exchanges/send/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update or delete an exchange message

```bash
curl -X PATCH "$DOKO_URL/api/exchanges/EXCHANGE_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Updated request for information",
    "raw": {
      "source": "api",
      "external_reference": "EXT-12345",
      "updated_by_script": true
    }
  }'
```

```bash
curl -X DELETE "$DOKO_URL/api/exchanges/EXCHANGE_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

exchange_url = f"{DOKO_URL}/api/exchanges/EXCHANGE_UUID/"

updated = requests.patch(
    exchange_url,
    headers=JSON_HEADERS,
    json={
        "subject": "Updated request for information",
        "raw": {
            "source": "api",
            "external_reference": "EXT-12345",
            "updated_by_script": True,
        },
    },
    timeout=30,
)
updated.raise_for_status()
print(updated.json())

removed = requests.delete(exchange_url, headers=HEADERS, timeout=30)
removed.raise_for_status()
```

### List available report templates

```bash
curl "$DOKO_URL/api/settings/report-templates/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/settings/report-templates/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Use the returned `id` as `template_id` when generating a report.

### Generate a case report with a specific template

```bash
curl -X POST "$DOKO_URL/api/cases/CASE_UUID/reports/generate/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": "TEMPLATE_UUID",
    "params": {
      "language": "en",
      "include_notes": false
    }
  }'
```

Python example:

```python
import requests

payload = {
    "template_id": "TEMPLATE_UUID",
    "params": {"language": "en", "include_notes": False},
}

response = requests.post(
    f"{DOKO_URL}/api/cases/CASE_UUID/reports/generate/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=120,
)
response.raise_for_status()
print(response.json())
```

The response includes report metadata and a `pdf_url` when the PDF is available.

### List generated reports for a case

```bash
curl "$DOKO_URL/api/cases/CASE_UUID/reports/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/cases/CASE_UUID/reports/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### List available workbook templates

```bash
curl "$DOKO_URL/api/settings/workbook-templates/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/settings/workbook-templates/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Use the returned `id` as `template_id` when applying a workbook template to a case.

### Read the case workbook

```bash
curl "$DOKO_URL/api/cases/CASE_UUID/workbook/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/cases/CASE_UUID/workbook/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Apply or remove a workbook template

Apply a template:

```bash
curl -X POST "$DOKO_URL/api/cases/CASE_UUID/workbook/apply/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": "TEMPLATE_UUID"
  }'
```

Remove the workbook template:

```bash
curl -X POST "$DOKO_URL/api/cases/CASE_UUID/workbook/apply/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": null
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/cases/CASE_UUID/workbook/apply/",
    headers=JSON_HEADERS,
    json={"template_id": "TEMPLATE_UUID"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update a workbook item

```bash
curl -X PATCH "$DOKO_URL/api/workbook-items/WORKBOOK_ITEM_ID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "is_done": true
  }'
```

Python example:

```python
import requests

response = requests.patch(
    f"{DOKO_URL}/api/workbook-items/WORKBOOK_ITEM_ID/",
    headers=JSON_HEADERS,
    json={"is_done": True},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Delete a case

Deletion is soft deletion.

```bash
curl -X POST "$DOKO_URL/api/events/CASE_UUID/delete/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/events/CASE_UUID/delete/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

_______________________________________________________________________

## Hunts

### Hunt fields

Common fields:

```json
{
  "title": "Threat hunting on suspicious domain",
  "context": "DNS resolution review",
  "conclusion": "",
  "status": "in_progress",
  "verdict": "unknown",
  "owner_id": 12,
  "reviewer_ids": [14, 15],
  "customer": "CUSTOMER_UUID",
  "investigation_started_at": "2026-05-19T08:00:00Z",
  "investigation_finished_at": null,
  "search_timeframe_start": "2026-05-18T00:00:00Z",
  "search_timeframe_end": "2026-05-19T08:00:00Z",
  "iocs": [
    {"field": "domain", "value": "bad.example", "status": "new"}
  ],
  "assets": [
    {"field": "hostname", "value": "proxy-01", "status": "observed"}
  ]
}
```

### List hunts

```bash
curl "$DOKO_URL/api/hunts/?status=in_progress&include_archived=0" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/hunts/",
    headers=HEADERS,
    params={"status": "in_progress", "include_archived": "0"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Create a hunt

```bash
curl -X POST "$DOKO_URL/api/hunts/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Threat hunting on suspicious domain",
    "context": "DNS resolution review",
    "conclusion": "",
    "status": "in_progress",
    "verdict": "unknown",
    "owner_id": 12,
    "reviewer_ids": [14, 15],
    "customer": "CUSTOMER_UUID",
    "investigation_started_at": "2026-05-19T08:00:00Z",
    "search_timeframe_start": "2026-05-18T00:00:00Z",
    "search_timeframe_end": "2026-05-19T08:00:00Z",
    "iocs": [
      {"field": "domain", "value": "bad.example", "status": "new"}
    ],
    "assets": [
      {"field": "hostname", "value": "proxy-01", "status": "observed"}
    ]
  }'
```

Python example:

```python
import requests

payload = {
    "title": "Threat hunting on suspicious domain",
    "context": "DNS resolution review",
    "conclusion": "",
    "status": "in_progress",
    "verdict": "unknown",
    "owner_id": 12,
    "reviewer_ids": [14, 15],
    "customer": "CUSTOMER_UUID",
    "investigation_started_at": "2026-05-19T08:00:00Z",
    "search_timeframe_start": "2026-05-18T00:00:00Z",
    "search_timeframe_end": "2026-05-19T08:00:00Z",
    "iocs": [{"field": "domain", "value": "bad.example", "status": "new"}],
    "assets": [{"field": "hostname", "value": "proxy-01", "status": "observed"}],
}

response = requests.post(
    f"{DOKO_URL}/api/hunts/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Modify a hunt

This example updates the context, dates, status and verdict.

```bash
curl -X PATCH "$DOKO_URL/api/hunts/HUNT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "context": "Objective: validate whether bad.example was contacted by monitored assets.",
    "status": "completed",
    "verdict": "malicious",
    "conclusion": "The hunt confirmed suspicious DNS activity.",
    "investigation_started_at": "2026-05-19T08:00:00Z",
    "investigation_finished_at": "2026-05-19T12:00:00Z",
    "search_timeframe_start": "2026-05-18T00:00:00Z",
    "search_timeframe_end": "2026-05-19T12:00:00Z"
  }'
```

Python example:

```python
import requests

payload = {
    "context": "Objective: validate whether bad.example was contacted by monitored assets.",
    "status": "completed",
    "verdict": "malicious",
    "conclusion": "The hunt confirmed suspicious DNS activity.",
    "investigation_started_at": "2026-05-19T08:00:00Z",
    "investigation_finished_at": "2026-05-19T12:00:00Z",
    "search_timeframe_start": "2026-05-18T00:00:00Z",
    "search_timeframe_end": "2026-05-19T12:00:00Z",
}

response = requests.patch(
    f"{DOKO_URL}/api/hunts/HUNT_UUID/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add or replace hunt IoCs and assets

IoCs and assets are replaced as full lists.

```bash
curl -X PATCH "$DOKO_URL/api/hunts/HUNT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "iocs": [
      {"field": "domain", "value": "bad.example", "status": "confirmed"},
      {"field": "ip", "value": "203.0.113.10", "status": "new"}
    ],
    "assets": [
      {"field": "hostname", "value": "proxy-01", "status": "confirmed"}
    ]
  }'
```

Python example:

```python
import requests

hunt_url = f"{DOKO_URL}/api/hunts/HUNT_UUID/"
hunt_response = requests.get(hunt_url, headers=HEADERS, timeout=30)
hunt_response.raise_for_status()
data = hunt_response.json()

iocs = data.get("iocs") or []
assets = data.get("assets") or []

iocs = [ioc for ioc in iocs if ioc.get("value") != "old.example"]
iocs.append({"field": "domain", "value": "bad.example", "status": "confirmed"})
assets.append({"field": "hostname", "value": "proxy-01", "status": "confirmed"})

response = requests.patch(
    hunt_url,
    headers=JSON_HEADERS,
    json={"iocs": iocs, "assets": assets},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add a hunt journal entry

```bash
curl -X POST "$DOKO_URL/api/hunts/HUNT_UUID/journal/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entry_type": "finding",
    "text": "<p>bad.example was resolved by proxy-01.</p>",
    "occurred_at": "2026-05-19T10:30:00Z",
    "linked_ioc_value": "bad.example",
    "linked_asset_value": "proxy-01"
  }'
```

Python example:

```python
import requests

payload = {
    "entry_type": "finding",
    "text": "<p>bad.example was resolved by proxy-01.</p>",
    "occurred_at": "2026-05-19T10:30:00Z",
    "linked_ioc_value": "bad.example",
    "linked_asset_value": "proxy-01",
}

response = requests.post(
    f"{DOKO_URL}/api/hunts/HUNT_UUID/journal/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update or delete a hunt journal entry

```bash
curl -X PATCH "$DOKO_URL/api/hunt-journal/JOURNAL_ENTRY_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "<p>Finding confirmed.</p>"
  }'
```

```bash
curl -X DELETE "$DOKO_URL/api/hunt-journal/JOURNAL_ENTRY_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

entry_url = f"{DOKO_URL}/api/hunt-journal/JOURNAL_ENTRY_UUID/"

updated = requests.patch(
    entry_url,
    headers=JSON_HEADERS,
    json={"text": "<p>Finding confirmed.</p>"},
    timeout=30,
)
updated.raise_for_status()

removed = requests.delete(entry_url, headers=HEADERS, timeout=30)
removed.raise_for_status()
```

### Link a hunt to a case

```bash
curl -X POST "$DOKO_URL/api/hunts/HUNT_UUID/case-links/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "link_type": "related"
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/hunts/HUNT_UUID/case-links/",
    headers=JSON_HEADERS,
    json={"case_id": "CASE_UUID", "link_type": "related"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Delete a hunt-to-case link

```bash
curl -X DELETE "$DOKO_URL/api/hunt-case-links/LINK_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.delete(
    f"{DOKO_URL}/api/hunt-case-links/LINK_UUID/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
```

### Archive and unarchive a hunt

```bash
curl -X POST "$DOKO_URL/api/hunts/HUNT_UUID/archive/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

```bash
curl -X POST "$DOKO_URL/api/hunts/HUNT_UUID/unarchive/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

archive = requests.post(
    f"{DOKO_URL}/api/hunts/HUNT_UUID/archive/",
    headers=HEADERS,
    timeout=30,
)
archive.raise_for_status()

unarchive = requests.post(
    f"{DOKO_URL}/api/hunts/HUNT_UUID/unarchive/",
    headers=HEADERS,
    timeout=30,
)
unarchive.raise_for_status()
```

_______________________________________________________________________

## Tasks

### Task fields

Common fields:

```json
{
  "title": "Review endpoint telemetry",
  "description": "Check EDR telemetry for srv-app-01.",
  "status": "to_do",
  "priority": "high",
  "due_date": "2026-05-20T12:00:00Z",
  "owner_id": 12,
  "customer_ids_write": ["CUSTOMER_UUID"]
}
```

Task statuses:

```text
to_do
in_progress
done
canceled
```

Task priorities:

```text
low
medium
high
critical
```

### List tasks

```bash
curl "$DOKO_URL/api/tasks/?scope=all&status=to_do&priority=high" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/tasks/",
    headers=HEADERS,
    params={"scope": "all", "status": "to_do", "priority": "high"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Useful filters:

```text
scope
search
status
priority
owner
customer
ordering
```

Use `scope=all` only when the token has permission to manage tasks. Otherwise, the API returns tasks owned by the token account.

### Create a task

```bash
curl -X POST "$DOKO_URL/api/tasks/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Review endpoint telemetry",
    "description": "Check EDR telemetry for srv-app-01.",
    "status": "to_do",
    "priority": "high",
    "due_date": "2026-05-20T12:00:00Z",
    "owner_id": 12,
    "customer_ids_write": ["CUSTOMER_UUID"]
  }'
```

Python example:

```python
import requests

payload = {
    "title": "Review endpoint telemetry",
    "description": "Check EDR telemetry for srv-app-01.",
    "status": "to_do",
    "priority": "high",
    "due_date": "2026-05-20T12:00:00Z",
    "owner_id": 12,
    "customer_ids_write": ["CUSTOMER_UUID"],
}

response = requests.post(
    f"{DOKO_URL}/api/tasks/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Modify a task

```bash
curl -X PATCH "$DOKO_URL/api/tasks/TASK_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "priority": "critical",
    "description": "Telemetry review started.",
    "due_date": "2026-05-20T18:00:00Z",
    "owner_id": 14,
    "customer_ids_write": ["CUSTOMER_UUID"]
  }'
```

Python example:

```python
import requests

payload = {
    "status": "in_progress",
    "priority": "critical",
    "description": "Telemetry review started.",
    "due_date": "2026-05-20T18:00:00Z",
    "owner_id": 14,
    "customer_ids_write": ["CUSTOMER_UUID"],
}

response = requests.patch(
    f"{DOKO_URL}/api/tasks/TASK_UUID/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Add a comment to a task

```bash
curl -X POST "$DOKO_URL/api/tasks/TASK_UUID/comments/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "<p>Telemetry review started.</p>"
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/tasks/TASK_UUID/comments/",
    headers=JSON_HEADERS,
    json={"text": "<p>Telemetry review started.</p>"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Update or delete a task comment

```bash
curl -X PATCH "$DOKO_URL/api/task-comments/COMMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "<p>Telemetry review completed.</p>"}'
```

```bash
curl -X DELETE "$DOKO_URL/api/task-comments/COMMENT_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

comment_url = f"{DOKO_URL}/api/task-comments/COMMENT_UUID/"

updated = requests.patch(
    comment_url,
    headers=JSON_HEADERS,
    json={"text": "<p>Telemetry review completed.</p>"},
    timeout=30,
)
updated.raise_for_status()

removed = requests.delete(comment_url, headers=HEADERS, timeout=30)
removed.raise_for_status()
```

### Link a task to a case

```bash
curl -X POST "$DOKO_URL/api/tasks/TASK_UUID/cases/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID"
  }'
```

Python example:

```python
import requests

response = requests.post(
    f"{DOKO_URL}/api/tasks/TASK_UUID/cases/",
    headers=JSON_HEADERS,
    json={"case_id": "CASE_UUID"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

### Delete a task-to-case link

```bash
curl -X DELETE "$DOKO_URL/api/task-case-links/LINK_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.delete(
    f"{DOKO_URL}/api/task-case-links/LINK_UUID/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
```

### Delete a task

Deletion is soft deletion.

```bash
curl -X DELETE "$DOKO_URL/api/tasks/TASK_UUID/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.delete(
    f"{DOKO_URL}/api/tasks/TASK_UUID/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
```

_______________________________________________________________________

## Global search

### Search in Doko

The query must contain at least 3 characters.

```bash
curl "$DOKO_URL/api/search/?q=bad.example" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/search/",
    headers=HEADERS,
    params={"q": "bad.example"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Typical response:

```json
{
  "query": "bad.example",
  "count": 3,
  "results": [
    {
      "type": "alert",
      "id": "ALERT_UUID",
      "title": "Suspicious DNS activity",
      "snippet": "bad.example was resolved...",
      "url": "/alerts/ALERT_UUID",
      "customer_name": "Customer A",
      "updated_at": "2026-05-19T10:30:00Z",
      "parent": null
    }
  ]
}
```

Possible result types include cases, alerts, hunts, comments, hunt journal entries, IoCs and assets.

_______________________________________________________________________

## Connectors

### List connector instances and endpoints

```bash
curl "$DOKO_URL/api/connectors/instances/" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/connectors/instances/",
    headers=HEADERS,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

Use the returned instance `id` as `connector_instance_id` and the endpoint `id` as `endpoint_id`.

### Run a connector against an IoC

```bash
curl -X POST "$DOKO_URL/api/connectors/run/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "target_type": "ioc",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "targets": [
      {"key": "ip", "value": "203.0.113.10"}
    ],
    "context": {
      "source": "api",
      "purpose": "enrichment"
    }
  }'
```

Python example:

```python
import requests

payload = {
    "case_id": "CASE_UUID",
    "target_type": "ioc",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "targets": [{"key": "ip", "value": "203.0.113.10"}],
    "context": {"source": "api", "purpose": "enrichment"},
}

response = requests.post(
    f"{DOKO_URL}/api/connectors/run/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=60,
)
response.raise_for_status()
print(response.json())
```

### Run a connector against an asset

```bash
curl -X POST "$DOKO_URL/api/connectors/run/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "target_type": "asset",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "targets": [
      {"key": "hostname", "value": "srv-app-01"}
    ],
    "context": {
      "source": "api",
      "purpose": "asset_enrichment"
    }
  }'
```

Python example:

```python
import requests

payload = {
    "case_id": "CASE_UUID",
    "target_type": "asset",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "targets": [{"key": "hostname", "value": "srv-app-01"}],
    "context": {"source": "api", "purpose": "asset_enrichment"},
}

response = requests.post(
    f"{DOKO_URL}/api/connectors/run/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=60,
)
response.raise_for_status()
print(response.json())
```

### Run a connector against the case itself

For `target_type=case`, the target is automatically the case id.

```bash
curl -X POST "$DOKO_URL/api/connectors/run/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "target_type": "case",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "context": {
      "source": "api",
      "purpose": "case_action"
    }
  }'
```

Python example:

```python
import requests

payload = {
    "case_id": "CASE_UUID",
    "target_type": "case",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "context": {"source": "api", "purpose": "case_action"},
}

response = requests.post(
    f"{DOKO_URL}/api/connectors/run/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=60,
)
response.raise_for_status()
print(response.json())
```

### Run a connector against multiple targets

Use this format to run one connector call set against several IoCs or assets.

```bash
curl -X POST "$DOKO_URL/api/connectors/run/" \
  -H "Authorization: Token $DOKO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_id": "CASE_UUID",
    "target_type": "ioc",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "targets": [
      {"key": "ip", "value": "203.0.113.10"},
      {"key": "domain", "value": "bad.example"}
    ],
    "context": {
      "source": "api",
      "purpose": "bulk_enrichment"
    }
  }'
```

Python example that runs a connector against every IoC already present on a case:

```python
import requests

case_response = requests.get(
    f"{DOKO_URL}/api/events/CASE_UUID/",
    headers=HEADERS,
    timeout=30,
)
case_response.raise_for_status()
case_data = case_response.json()

targets = [
    {"key": item.get("field") or item.get("type") or "ioc", "value": item.get("value")}
    for item in case_data.get("iocs", [])
    if item.get("value")
]

payload = {
    "case_id": "CASE_UUID",
    "target_type": "ioc",
    "connector_instance_id": "CONNECTOR_INSTANCE_ID",
    "endpoint_id": "CONNECTOR_ENDPOINT_ID",
    "targets": targets,
    "context": {"source": "api", "purpose": "bulk_enrichment"},
}

response = requests.post(
    f"{DOKO_URL}/api/connectors/run/",
    headers=JSON_HEADERS,
    json=payload,
    timeout=120,
)
response.raise_for_status()
print(response.json())
```

### List connector results

```bash
curl "$DOKO_URL/api/connectors/results/?case_id=CASE_UUID" \
  -H "Authorization: Token $DOKO_TOKEN"
```

Python example:

```python
import requests

response = requests.get(
    f"{DOKO_URL}/api/connectors/results/",
    headers=HEADERS,
    params={"case_id": "CASE_UUID"},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

_______________________________________________________________________

## Catbot

The Chatbot API is used to run prompts against a Doko context, retrieve the generated response, create a postable draft, and post that draft to the target object.

The common workflow is:

1. Create or reuse a chat session.
2. Start a run with a prompt.
3. Poll the run until it reaches a final status.
4. Create a draft from the completed run.
5. Post the draft to the target object.

This workflow avoids posting incomplete results. A run can take time depending on the selected provider, prompt size, context size, and investigation command duration. Scripts should poll the run status and use a timeout.

Use the same token authentication format as the rest of the API:

```http
Authorization: Token YOUR_TOKEN
Content-Type: application/json
```

In the examples below, replace:

```text
http://YOUR_DOKO
```

with the URL of the Doko instance.

### Important status values

A chat run can return these status values:

```text
queued
running
completed
failed
cancelled
```

Only post a result when the run status is `completed`.

If the status is `failed`, read `error_message`.

If the status is still `queued` or `running` after the script timeout, do not post the result automatically.

## 3. Postable target types

A generated draft can be posted to these targets:

```text
case_comment
alert_comment
hunt_note
```

Use:

- `case_comment` to post the result as a case comment
- `alert_comment` to post the result as an alert comment
- `hunt_note` to post the result as a hunt journal entry

### Create a chat session

A session groups prompts and responses. For object-specific prompts, provide the object type and identifier.

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "surface": "contextual",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "customer_id": "CUSTOMER_UUID",
    "client_tab_id": "script-case-analysis",
    "title": "Case analysis"
  }'
```

Typical response:

```json
{
  "id": "CHAT_SESSION_UUID",
  "title": "Case analysis",
  "surface": "contextual",
  "page_type": "case",
  "object_id": "CASE_UUID",
  "customer_id": "CUSTOMER_UUID",
  "client_tab_id": "script-case-analysis",
  "created_at": "2026-05-19T10:00:00Z",
  "updated_at": "2026-05-19T10:00:00Z",
  "messages": []
}
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

payload = {
    "surface": "contextual",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "customer_id": "CUSTOMER_UUID",
    "client_tab_id": "script-case-analysis",
    "title": "Case analysis",
}

response = requests.post(f"{DOKO_URL}/api/chat/sessions", headers=headers, json=payload, timeout=30)
response.raise_for_status()
print(response.json())
```

### Run a prompt

Start a run in an existing session.

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/runs" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this case. Focus on the incident timeline, IoCs, assets, current status, and recommended next steps.",
    "client_tab_id": "script-case-analysis",
    "request_id": "case-summary-001",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "current_tab": "summary",
    "inclusions": ["summary", "iocs", "assets", "incident_timeline", "comments", "exchanges"]
  }'
```

Typical response:

```json
{
  "id": "CHAT_RUN_UUID",
  "request_id": "case-summary-001",
  "client_tab_id": "script-case-analysis",
  "status": "queued",
  "prompt": "Summarize this case. Focus on the incident timeline, IoCs, assets, current status, and recommended next steps.",
  "response_text": "",
  "error_message": "",
  "selected_template_code": "",
  "selected_command": "",
  "provider_execution": {},
  "cancel_requested": false,
  "started_at": null,
  "completed_at": null,
  "drafts": [],
  "actions": []
}
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
SESSION_ID = "CHAT_SESSION_UUID"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

payload = {
    "prompt": "Summarize this case. Focus on the incident timeline, IoCs, assets, current status, and recommended next steps.",
    "client_tab_id": "script-case-analysis",
    "request_id": "case-summary-001",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "current_tab": "summary",
    "inclusions": ["summary", "iocs", "assets", "incident_timeline", "comments", "exchanges"],
}

response = requests.post(f"{DOKO_URL}/api/chat/sessions/{SESSION_ID}/runs", headers=headers, json=payload, timeout=30)
response.raise_for_status()
print(response.json())
```

### Wait for a prompt to finish

A run is asynchronous. Scripts should poll the run detail endpoint until the status is final.

#### Curl

```bash
curl "http://YOUR_DOKO/api/chat/runs/CHAT_RUN_UUID" \
  -H "Authorization: Token YOUR_TOKEN"
```

#### Python

```python
import time
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
RUN_ID = "CHAT_RUN_UUID"

headers = {
    "Authorization": f"Token {TOKEN}",
}

final_statuses = {"completed", "failed", "cancelled"}
started_at = time.time()
timeout_seconds = 180
interval_seconds = 3

while True:
    response = requests.get(f"{DOKO_URL}/api/chat/runs/{RUN_ID}", headers=headers, timeout=30)
    response.raise_for_status()
    run = response.json()

    if run.get("status") in final_statuses:
        break

    if time.time() - started_at > timeout_seconds:
        raise TimeoutError("Chat run did not finish before timeout")

    time.sleep(interval_seconds)

if run.get("status") != "completed":
    raise RuntimeError(run.get("error_message") or f"Run ended with status {run.get('status')}")

print(run["response_text"])
```

### Create a draft from a completed run

A draft stores the generated content before it is posted. This makes it possible to post to a case, alert, or hunt only after the run has completed successfully.

#### Create a case comment draft

```bash
curl -X POST "http://YOUR_DOKO/api/chat/runs/CHAT_RUN_UUID/drafts" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_type": "case_comment",
    "target_id": "CASE_UUID"
  }'
```

#### Create an alert comment draft

```bash
curl -X POST "http://YOUR_DOKO/api/chat/runs/CHAT_RUN_UUID/drafts" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_type": "alert_comment",
    "target_id": "ALERT_UUID"
  }'
```

#### Create a hunt journal draft

```bash
curl -X POST "http://YOUR_DOKO/api/chat/runs/CHAT_RUN_UUID/drafts" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_type": "hunt_note",
    "target_id": "HUNT_UUID"
  }'
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
RUN_ID = "CHAT_RUN_UUID"
CASE_ID = "CASE_UUID"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

payload = {
    "target_type": "case_comment",
    "target_id": CASE_ID,
}

response = requests.post(f"{DOKO_URL}/api/chat/runs/{RUN_ID}/drafts", headers=headers, json=payload, timeout=30)
response.raise_for_status()
print(response.json())
```

### Post a draft

Posting a draft creates the target comment or hunt note.

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/drafts/DRAFT_UUID/post" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
DRAFT_ID = "DRAFT_UUID"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

response = requests.post(f"{DOKO_URL}/api/chat/drafts/{DRAFT_ID}/post", headers=headers, json={}, timeout=30)
response.raise_for_status()
print(response.json())
```

### Full workflow: summarize a case and post the result as a comment

This script creates a session, runs a prompt, waits for completion, creates a draft, and posts the draft to the case.

```python
import time
import uuid
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
CASE_ID = "CASE_UUID"
CUSTOMER_ID = "CUSTOMER_UUID"

headers_json = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}
headers_auth = {
    "Authorization": f"Token {TOKEN}",
}

client_tab_id = "script-case-summary"

session_payload = {
    "surface": "contextual",
    "page_type": "case",
    "object_id": CASE_ID,
    "customer_id": CUSTOMER_ID,
    "client_tab_id": client_tab_id,
    "title": "Automated case summary",
}

session_response = requests.post(f"{DOKO_URL}/api/chat/sessions", headers=headers_json, json=session_payload, timeout=30)
session_response.raise_for_status()
session_id = session_response.json()["id"]

run_payload = {
    "prompt": "Summarize this case for the activity comments. Include current status, key facts, relevant IoCs and assets, and recommended next steps.",
    "client_tab_id": client_tab_id,
    "request_id": f"case-summary-{uuid.uuid4()}",
    "page_type": "case",
    "object_id": CASE_ID,
    "current_tab": "summary",
    "inclusions": ["summary", "iocs", "assets", "incident_timeline", "comments", "exchanges"],
}

run_response = requests.post(f"{DOKO_URL}/api/chat/sessions/{session_id}/runs", headers=headers_json, json=run_payload, timeout=30)
run_response.raise_for_status()
run_id = run_response.json()["id"]

started_at = time.time()
while True:
    detail_response = requests.get(f"{DOKO_URL}/api/chat/runs/{run_id}", headers=headers_auth, timeout=30)
    detail_response.raise_for_status()
    run = detail_response.json()
    status = run.get("status")

    if status in {"completed", "failed", "cancelled"}:
        break

    if time.time() - started_at > 180:
        raise TimeoutError("Chat run did not finish before timeout")

    time.sleep(3)

if run.get("status") != "completed":
    raise RuntimeError(run.get("error_message") or f"Run ended with status {run.get('status')}")

draft_payload = {
    "target_type": "case_comment",
    "target_id": CASE_ID,
}

draft_response = requests.post(f"{DOKO_URL}/api/chat/runs/{run_id}/drafts", headers=headers_json, json=draft_payload, timeout=30)
draft_response.raise_for_status()
draft_id = draft_response.json()["id"]

post_response = requests.post(f"{DOKO_URL}/api/chat/drafts/{draft_id}/post", headers=headers_json, json={}, timeout=30)
post_response.raise_for_status()
print(post_response.json())
```

### Analyze a case and post the result as a comment

Use a more explicit prompt when the result should be investigation-oriented.

#### Curl prompt

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/runs" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze this case. Identify suspicious indicators, affected assets, possible attack path, missing information, and recommended containment actions. Return a structured analysis suitable for a case comment.",
    "client_tab_id": "script-case-analysis",
    "request_id": "case-analysis-001",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "current_tab": "summary",
    "inclusions": ["summary", "iocs", "assets", "incident_timeline", "comments", "exchanges"]
  }'
```

#### Python prompt payload

```python
payload = {
    "prompt": "Analyze this case. Identify suspicious indicators, affected assets, possible attack path, missing information, and recommended containment actions. Return a structured analysis suitable for a case comment.",
    "client_tab_id": "script-case-analysis",
    "request_id": "case-analysis-001",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "current_tab": "summary",
    "inclusions": ["summary", "iocs", "assets", "incident_timeline", "comments", "exchanges"],
}
```

After the run is completed, create and post a `case_comment` draft.

### Summarize an alert and post the result as an alert comment

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "surface": "contextual",
    "page_type": "alert",
    "object_id": "ALERT_UUID",
    "customer_id": "CUSTOMER_UUID",
    "client_tab_id": "script-alert-summary",
    "title": "Alert summary"
  }'
```

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/runs" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this alert. Include severity, classification, source, IoCs, assets, and recommended triage decision.",
    "client_tab_id": "script-alert-summary",
    "request_id": "alert-summary-001",
    "page_type": "alert",
    "object_id": "ALERT_UUID",
    "inclusions": ["summary", "iocs", "assets", "comments"]
  }'
```

After completion, create a draft with:

```json
{
  "target_type": "alert_comment",
  "target_id": "ALERT_UUID"
}
```

Then post the draft.

### Summarize a hunt and post the result as a hunt note

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "surface": "contextual",
    "page_type": "hunt",
    "object_id": "HUNT_UUID",
    "customer_id": "CUSTOMER_UUID",
    "client_tab_id": "script-hunt-summary",
    "title": "Hunt summary"
  }'
```

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/runs" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this hunt. Include objective, context, timeline, indicators, assets, verdict, and remaining actions.",
    "client_tab_id": "script-hunt-summary",
    "request_id": "hunt-summary-001",
    "page_type": "hunt",
    "object_id": "HUNT_UUID",
    "inclusions": ["summary", "journal", "iocs", "assets", "timeline", "case_links"]
  }'
```

After completion, create a draft with:

```json
{
  "target_type": "hunt_note",
  "target_id": "HUNT_UUID"
}
```

Then post the draft.

### List available investigation commands

Investigation templates can expose chat commands. Use the actions endpoint to list commands available to the account.

#### Curl

```bash
curl "http://YOUR_DOKO/api/chat/actions" \
  -H "Authorization: Token YOUR_TOKEN"
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"

headers = {
    "Authorization": f"Token {TOKEN}",
}

response = requests.get(f"{DOKO_URL}/api/chat/actions", headers=headers, timeout=30)
response.raise_for_status()
print(response.json())
```

Use the returned command name in the prompt when launching a command through the Chatbot.

### Run an investigation command from a prompt

A command can be launched by sending a prompt that starts with the configured command.

Example command prompt:

```text
/virustotal-ip 203.0.113.10
```

The run response can include:

- `selected_command`
- `selected_template_code`
- `provider_execution`
- `actions`

The `actions` list contains execution details, including status, input payload, output payload, raw response payload, remote run ID, remote status, and errors when available.

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/runs" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "/INVESTIGATION_COMMAND 203.0.113.10",
    "client_tab_id": "script-investigation-command",
    "request_id": "investigation-command-001",
    "page_type": "case",
    "object_id": "CASE_UUID",
    "current_tab": "indicators",
    "inclusions": ["summary", "iocs", "assets"]
  }'
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
SESSION_ID = "CHAT_SESSION_UUID"
CASE_ID = "CASE_UUID"
COMMAND = "/INVESTIGATION_COMMAND"
VALUE = "203.0.113.10"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

payload = {
    "prompt": f"{COMMAND} {VALUE}",
    "client_tab_id": "script-investigation-command",
    "request_id": "investigation-command-001",
    "page_type": "case",
    "object_id": CASE_ID,
    "current_tab": "indicators",
    "inclusions": ["summary", "iocs", "assets"],
}

response = requests.post(f"{DOKO_URL}/api/chat/sessions/{SESSION_ID}/runs", headers=headers, json=payload, timeout=30)
response.raise_for_status()
print(response.json())
```

After completion, post the result as a case comment by creating and posting a `case_comment` draft.

### Run one investigation command per IoC and post the results

Use this workflow when several IoCs must be checked separately.

```python
import time
import uuid
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
CASE_ID = "CASE_UUID"
CUSTOMER_ID = "CUSTOMER_UUID"
COMMAND = "/INVESTIGATION_COMMAND"
IOCS = [
    {"field": "ip", "value": "203.0.113.10", "status": "new"},
    {"field": "domain", "value": "example.org", "status": "new"},
]

headers_json = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}
headers_auth = {
    "Authorization": f"Token {TOKEN}",
}

client_tab_id = "script-ioc-investigation"

session_payload = {
    "surface": "contextual",
    "page_type": "case",
    "object_id": CASE_ID,
    "customer_id": CUSTOMER_ID,
    "client_tab_id": client_tab_id,
    "title": "IoC investigation",
}

session_response = requests.post(f"{DOKO_URL}/api/chat/sessions", headers=headers_json, json=session_payload, timeout=30)
session_response.raise_for_status()
session_id = session_response.json()["id"]

for ioc in IOCS:
    value = ioc["value"]
    run_payload = {
        "prompt": f"{COMMAND} {value}",
        "client_tab_id": client_tab_id,
        "request_id": f"ioc-{value}-{uuid.uuid4()}",
        "page_type": "case",
        "object_id": CASE_ID,
        "current_tab": "indicators",
        "inclusions": ["summary", "iocs", "assets"],
    }

    run_response = requests.post(f"{DOKO_URL}/api/chat/sessions/{session_id}/runs", headers=headers_json, json=run_payload, timeout=30)
    run_response.raise_for_status()
    run_id = run_response.json()["id"]

    started_at = time.time()
    while True:
        detail_response = requests.get(f"{DOKO_URL}/api/chat/runs/{run_id}", headers=headers_auth, timeout=30)
        detail_response.raise_for_status()
        run = detail_response.json()
        status = run.get("status")

        if status in {"completed", "failed", "cancelled"}:
            break

        if time.time() - started_at > 300:
            raise TimeoutError(f"Command did not finish before timeout for {value}")

        time.sleep(3)

    if run.get("status") != "completed":
        raise RuntimeError(run.get("error_message") or f"Run ended with status {run.get('status')} for {value}")

    draft_payload = {
        "target_type": "case_comment",
        "target_id": CASE_ID,
    }

    draft_response = requests.post(f"{DOKO_URL}/api/chat/runs/{run_id}/drafts", headers=headers_json, json=draft_payload, timeout=30)
    draft_response.raise_for_status()
    draft_id = draft_response.json()["id"]

    post_response = requests.post(f"{DOKO_URL}/api/chat/drafts/{draft_id}/post", headers=headers_json, json={}, timeout=30)
    post_response.raise_for_status()
    print(post_response.json())
```

### Run one investigation command per asset and post the results

```python
import time
import uuid
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
CASE_ID = "CASE_UUID"
CUSTOMER_ID = "CUSTOMER_UUID"
COMMAND = "/INVESTIGATION_COMMAND"
ASSETS = [
    {"field": "hostname", "value": "srv-app-01", "status": "observed"},
    {"field": "user", "value": "jdoe", "status": "observed"},
]

headers_json = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}
headers_auth = {
    "Authorization": f"Token {TOKEN}",
}

client_tab_id = "script-asset-investigation"

session_payload = {
    "surface": "contextual",
    "page_type": "case",
    "object_id": CASE_ID,
    "customer_id": CUSTOMER_ID,
    "client_tab_id": client_tab_id,
    "title": "Asset investigation",
}

session_response = requests.post(f"{DOKO_URL}/api/chat/sessions", headers=headers_json, json=session_payload, timeout=30)
session_response.raise_for_status()
session_id = session_response.json()["id"]

for asset in ASSETS:
    value = asset["value"]
    run_payload = {
        "prompt": f"{COMMAND} {value}",
        "client_tab_id": client_tab_id,
        "request_id": f"asset-{value}-{uuid.uuid4()}",
        "page_type": "case",
        "object_id": CASE_ID,
        "current_tab": "indicators",
        "inclusions": ["summary", "iocs", "assets"],
    }

    run_response = requests.post(f"{DOKO_URL}/api/chat/sessions/{session_id}/runs", headers=headers_json, json=run_payload, timeout=30)
    run_response.raise_for_status()
    run_id = run_response.json()["id"]

    started_at = time.time()
    while True:
        detail_response = requests.get(f"{DOKO_URL}/api/chat/runs/{run_id}", headers=headers_auth, timeout=30)
        detail_response.raise_for_status()
        run = detail_response.json()
        status = run.get("status")

        if status in {"completed", "failed", "cancelled"}:
            break

        if time.time() - started_at > 300:
            raise TimeoutError(f"Command did not finish before timeout for {value}")

        time.sleep(3)

    if run.get("status") != "completed":
        raise RuntimeError(run.get("error_message") or f"Run ended with status {run.get('status')} for {value}")

    draft_payload = {
        "target_type": "case_comment",
        "target_id": CASE_ID,
    }

    draft_response = requests.post(f"{DOKO_URL}/api/chat/runs/{run_id}/drafts", headers=headers_json, json=draft_payload, timeout=30)
    draft_response.raise_for_status()
    draft_id = draft_response.json()["id"]

    post_response = requests.post(f"{DOKO_URL}/api/chat/drafts/{draft_id}/post", headers=headers_json, json={}, timeout=30)
    post_response.raise_for_status()
    print(post_response.json())
```

### Run several commands, then post one combined comment

When many indicators are checked, posting one comment per result can be noisy. Another option is to collect all completed responses and post one combined case comment through the normal case comment endpoint.

```python
import time
import uuid
import html
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
CASE_ID = "CASE_UUID"
CUSTOMER_ID = "CUSTOMER_UUID"
COMMAND = "/INVESTIGATION_COMMAND"
VALUES = ["203.0.113.10", "198.51.100.24", "example.org"]

headers_json = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}
headers_auth = {
    "Authorization": f"Token {TOKEN}",
}

client_tab_id = "script-bulk-investigation"

session_payload = {
    "surface": "contextual",
    "page_type": "case",
    "object_id": CASE_ID,
    "customer_id": CUSTOMER_ID,
    "client_tab_id": client_tab_id,
    "title": "Bulk investigation",
}

session_response = requests.post(f"{DOKO_URL}/api/chat/sessions", headers=headers_json, json=session_payload, timeout=30)
session_response.raise_for_status()
session_id = session_response.json()["id"]

results = []

for value in VALUES:
    run_payload = {
        "prompt": f"{COMMAND} {value}",
        "client_tab_id": client_tab_id,
        "request_id": f"bulk-{value}-{uuid.uuid4()}",
        "page_type": "case",
        "object_id": CASE_ID,
        "current_tab": "indicators",
        "inclusions": ["summary", "iocs", "assets"],
    }

    run_response = requests.post(f"{DOKO_URL}/api/chat/sessions/{session_id}/runs", headers=headers_json, json=run_payload, timeout=30)
    run_response.raise_for_status()
    run_id = run_response.json()["id"]

    started_at = time.time()
    while True:
        detail_response = requests.get(f"{DOKO_URL}/api/chat/runs/{run_id}", headers=headers_auth, timeout=30)
        detail_response.raise_for_status()
        run = detail_response.json()
        status = run.get("status")

        if status in {"completed", "failed", "cancelled"}:
            break

        if time.time() - started_at > 300:
            results.append({"value": value, "status": "timeout", "text": "The command did not finish before timeout."})
            run = None
            break

        time.sleep(3)

    if not run:
        continue

    if run.get("status") == "completed":
        results.append({"value": value, "status": "completed", "text": run.get("response_text") or ""})
    else:
        results.append({"value": value, "status": run.get("status"), "text": run.get("error_message") or ""})

blocks = ["<p><strong>Bulk investigation results</strong></p>"]
for item in results:
    value = html.escape(item["value"])
    status = html.escape(item["status"])
    text = html.escape(item["text"])
    blocks.append(f"<h4>{value} - {status}</h4><pre>{text}</pre>")

comment_payload = {
    "text": "\n".join(blocks),
}

comment_response = requests.post(f"{DOKO_URL}/api/events/{CASE_ID}/comments/", headers=headers_json, json=comment_payload, timeout=30)
comment_response.raise_for_status()
print(comment_response.json())
```

### Cancel a running prompt

Use this endpoint when a run should no longer continue.

#### Curl

```bash
curl -X POST "http://YOUR_DOKO/api/chat/runs/CHAT_RUN_UUID/cancel" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Python

```python
import requests

DOKO_URL = "http://YOUR_DOKO"
TOKEN = "YOUR_TOKEN"
RUN_ID = "CHAT_RUN_UUID"

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

response = requests.post(f"{DOKO_URL}/api/chat/runs/{RUN_ID}/cancel", headers=headers, json={}, timeout=30)
response.raise_for_status()
print(response.json())
```

### Clear or archive a session

#### Clear a session

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/clear" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Archive a session

```bash
curl -X POST "http://YOUR_DOKO/api/chat/sessions/CHAT_SESSION_UUID/archive/" \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Recommended timeouts

Use separate timeouts for HTTP requests and for the full run.

Recommended values:

- HTTP request timeout: 30 seconds
- Simple summary run timeout: 120 to 180 seconds
- Investigation command timeout: 300 seconds or more
- Bulk command workflow timeout: one timeout per item

Avoid posting automatically when a run times out. A timeout means the script stopped waiting, not necessarily that the run failed.

### Common errors

#### 400 Bad Request

The request body is invalid or required fields are missing.

Common causes:

- missing `prompt`
- missing `client_tab_id`
- missing or duplicated `request_id`
- unsupported `target_type` when creating a draft

#### 401 Unauthorized

The token is missing, invalid, expired, or revoked.

#### 403 Forbidden

The token does not have access to the requested object or Chatbot capability.

#### 404 Not Found

The session, run, draft, or target object was not found, or is outside the token scope.

#### 409 Conflict

The same `request_id` may already have been used in the same session.

#### 500 Server Error

The provider, command, or external execution may have failed unexpectedly. Check the run `error_message` and action `error_message` fields.

### Practical prompt examples

#### Case summary

```text
Summarize this case for the activity comments. Include current status, key facts, relevant IoCs and assets, and recommended next steps.
```

#### Case investigation analysis

```text
Analyze this case. Identify suspicious indicators, affected assets, possible attack path, missing information, and recommended containment actions. Return a structured analysis suitable for a case comment.
```

#### Case handover

```text
Prepare a handover note for this case. Include what happened, what has already been checked, what remains uncertain, and what should be done next.
```

#### Alert triage

```text
Summarize this alert. Include severity, classification, source, IoCs, assets, and recommended triage decision.
```

#### Hunt summary

```text
Summarize this hunt. Include objective, context, timeline, indicators, assets, verdict, and remaining actions.
```

#### Investigation command

```text
/INVESTIGATION_COMMAND 203.0.113.10
```

### 23. Endpoint summary

```text
GET  /api/chat/sessions
POST /api/chat/sessions
POST /api/chat/sessions/{session_id}/runs
GET  /api/chat/runs/{run_id}
POST /api/chat/runs/{run_id}/drafts
POST /api/chat/drafts/{draft_id}/post
POST /api/chat/sessions/{session_id}/clear
POST /api/chat/sessions/{session_id}/archive/
GET  /api/chat/actions
POST /api/chat/runs/{run_id}/cancel
```

_______________________________________________________________________


## Errors

### 400 Bad Request

The request body is invalid, a required field is missing, a value has the wrong type, or the selected status, severity or classification is not accepted.

### 401 Unauthorized

The token is missing, invalid, revoked or expired.

### 403 Forbidden

The token is valid, but the account does not have the required permission or customer access.

### 404 Not Found

The object does not exist, was deleted, or is outside the token account scope.

### 409 Conflict

The requested operation conflicts with the current state. Example: linking an alert already linked to another case.

_______________________________________________________________________

## Complete minimal Python client

```python
import requests

class DokoClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Token {token}"}
        self.json_headers = {**self.headers, "Content-Type": "application/json"}

    def get(self, path: str, **params):
        response = requests.get(
            f"{self.base_url}{path}",
            headers=self.headers,
            params={k: v for k, v in params.items() if v is not None},
            timeout=30,
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def post(self, path: str, payload=None):
        response = requests.post(
            f"{self.base_url}{path}",
            headers=self.json_headers,
            json=payload or {},
            timeout=60,
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def patch(self, path: str, payload):
        response = requests.patch(
            f"{self.base_url}{path}",
            headers=self.json_headers,
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def delete(self, path: str):
        response = requests.delete(
            f"{self.base_url}{path}",
            headers=self.headers,
            timeout=30,
        )
        response.raise_for_status()
        return response.json() if response.content else None

client = DokoClient("https://YOUR_DOKO_INSTANCE", "YOUR_API_TOKEN")
me = client.get("/api/me/")
print(me)
```
