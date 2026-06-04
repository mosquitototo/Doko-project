## Table of contents

- [LLM Provider](#llm-provider)
- [SOAR Provider](#soar-provider)
- [Investigation Templates](#investigation-templates)
- [n8n exemple](#n8n-exemple)
- [Splunk SOAR example](#splunk-soar-example)
- [Field names](#field-names)
- [Troubleshooting](#troubleshooting)
- [Recommended patterns](#recommended-patterns)


## LLM Provider

The LLM provider defines the AI service used by the assistant to answer prompts, summarize content, and prepare investigation outputs.

Only one LLM provider is configured from this page.

### Name

Display name of the LLM provider.

Example:

```text
OpenAI GPT-4.1
```

Use a name that clearly identifies the provider and model family.

### Provider kind

Type of LLM provider.

Common values:

```text
litellm
openai
ollama
openai_compatible
```

Use `litellm` when the configured endpoint is exposed through LiteLLM.
Use `openai_compatible` when the service follows the OpenAI-compatible API format.
Use a custom value only when the instance has been configured to support it.

### Default model

Model used by default when the assistant runs a prompt.

Examples:

```text
gpt-4.1
```

```text
claude-3-5-sonnet-latest
```

```text
llama3.1:8b
```

The value must match the model name expected by the configured LLM endpoint.

### Timeout seconds

Maximum time allowed for one LLM request.

Recommended values:

```text
60
```

```text
90
```

Use a higher value for slower local models. Avoid very high values because users may wait longer before receiving an error.

### Base URL

Endpoint used to reach the LLM provider.

Examples:

```text
https://api.openai.com/v1
```

```text
http://litellm:4000/v1
```

```text
http://ollama:11434/v1
```

The URL must point to the API base expected by the selected provider.

### Default system prompt

Default instruction sent to the model before user prompts.

Use it to define global assistant behavior.

Example:

```text
You are a SOC assistant. Answer clearly, stay factual, and avoid exposing sensitive information unless it is required for the investigation.
```

Recommendations:

- Keep the prompt short and explicit.
- Avoid putting secrets, API keys, passwords, or customer-specific confidential data in this field.
- Use neutral instructions that apply to every user.

### API key

Secret used to authenticate to the LLM provider.

When editing an existing provider, leave this field empty to keep the current key.

Examples:

```text
sk-...
```

```text
litellm-master-key
```

### Enabled

Defines whether this LLM provider can be used.

Disable it when the endpoint is unavailable or when the provider should no longer be used.

---

## SOAR Provider

A SOAR provider defines how Doko reaches a remote automation platform.

Investigation templates are attached to a SOAR provider. The provider handles the connection, authentication, and timeout.

### Name

Display name of the SOAR provider.

Examples:

```text
n8n Production
```

```text
Splunk SOAR
```

Use a name that identifies the remote platform and environment.

### Provider kind

Type of remote automation platform.

Common values:

```text
generic_http
```

```text
n8n
```

```text
splunk_soar
```

Use `generic_http` when the provider is a simple HTTP endpoint.
Use `n8n` for n8n workflows.
Use `splunk_soar` for Splunk SOAR playbooks.

### Timeout seconds

Maximum time allowed for one request to the SOAR provider.

Recommended values:

```text
60
```

```text
90
```

Use a value that matches the expected response time of the remote platform.

For long playbooks or workflows, prefer an asynchronous design where the remote platform quickly returns a run identifier and exposes a separate status/result endpoint.

### Base URL

URL used to reach the remote automation platform.

For webhook-based platforms such as n8n, this can be the full webhook URL.

Example for n8n:

```text
https://n8n.example.com/webhook/doko-investigation
```

Example for Splunk SOAR:

```text
https://soar.example.com
```

If the remote platform expects a dedicated execution endpoint, use the exact URL that accepts the execution request.

Recommendations:

- Prefer HTTPS.
- Do not include credentials in the URL.
- Do not include query strings unless the endpoint specifically requires them.
- Use a stable production URL rather than a temporary test URL.

### Auth type

Authentication method used for the SOAR provider.

Available values:

```text
none
```

```text
jwt / bearer
```

```text
basic
```

```text
header
```

Use:

- `none` when the endpoint is protected by network controls or does not require authentication.
- `jwt / bearer` when the endpoint expects `Authorization: Bearer <token>`.
- `basic` when the endpoint expects HTTP Basic authentication.
- `header` when the endpoint expects a custom header such as `X-N8N-API-KEY`, `X-Doko-Token`, or `ph-auth-token`.

### Type of authentication token

Header name used when `Auth type` is set to `header`.

Examples:

```text
X-Doko-Token
```

```text
X-N8N-API-KEY
```

```text
ph-auth-token
```

Leave this empty for `none`, `jwt / bearer`, or `basic` authentication.

### Username

Username used when `Auth type` is set to `basic`.

Example:

```text
api-user
```

Leave this empty for other authentication types.

### Value of token/password/API key

Secret value used for the selected authentication method.

Examples:

```text
my-n8n-shared-token
```

```text
splunk-soar-api-token
```

```text
basic-auth-password
```

When editing an existing provider, leave this field empty to keep the current secret.

### Enabled

Defines whether this SOAR provider can be used by investigation templates.

Disable it when the remote platform is unavailable or should not receive new requests.

---

## Investigation Templates

An investigation template defines one controlled action that can be launched by the assistant.

Examples:

- Enrich an IP address.
- Analyze a domain.
- Search activity for a username.
- Launch a Splunk SOAR playbook against a container.
- Launch an n8n workflow with the selected IoC or asset.

### Name

Display name of the investigation template.

Example:

```text
Analyze IP with n8n
```

Use a name that clearly describes the action.

### Chat command

Optional command that users can type to run the template directly.

Examples:

```text
/analyze_ip
```

```text
/summarize_case
```

```text
/splunk_soar_playbook
```

Rules:

- The command must start with `/`.
- Use lowercase letters, numbers, `_`, `-`, or `:`.
- Each enabled command must be unique.

A command is useful when the user should be able to explicitly select the action instead of relying on automatic template selection.

### SOAR provider

SOAR provider used by this template.

Select the provider that points to the platform where the playbook or workflow will run.

### Playbook / workflow name

Remote playbook or workflow identifier.

Examples for n8n:

```text
doko-ioc-enrichment
```

```text
doko-case-summary
```

Examples for Splunk SOAR:

```text
local/doko_ip_enrichment
```

```text
local/doko_case_triage
```

This value is sent to the remote platform through the field configured in **Playbook / workflow API field**.

### Playbook / workflow API field

Name of the field expected by the remote platform for the playbook or workflow identifier.

Examples:

```text
workflow
```

```text
workflow_name
```

```text
playbook_id
```

```text
playbook_name
```

For Splunk SOAR, `playbook_id` is commonly used.
For n8n, this field depends on the webhook design. If the n8n webhook already represents one workflow, this field can still be used as metadata.

### Target object payload field

Name of the field used to send the target object identifier.

Examples:

```text
container_id
```

```text
incident_id
```

```text
case_id
```

```text
object_id
```

Use the value expected by the remote playbook or workflow.

For Splunk SOAR, `container_id` is commonly used.
For n8n, use a field name that matches the first node of the workflow.

### Input payload API field

Top-level field used to group the investigation input.

Examples:

```text
inputs
```

```text
payload
```

```text
data
```

If the remote platform expects the user-provided value inside an `inputs` object, use:

```text
inputs
```

The resulting payload follows this idea:

```json
{
  "inputs": {
    "doko_output": "the selected value"
  }
}
```

### Input variable name

Name of the variable sent inside the input payload field.

Examples:

```text
doko_output
```

```text
observable
```

```text
indicator
```

```text
target
```

Use the variable name expected by the remote playbook or workflow.

If the user launches a command on an IoC, this variable receives the selected IoC value. If the user launches a command on an asset, this variable receives the selected asset value.

### Default target object id

Optional default value for the target object field.

Example:

```text
47005
```

Use it only when the playbook or workflow must always run against a fixed object.

Leave it empty when the target object should be provided at runtime by the case, alert, hunt, or selected item.

### Description

Short explanation of what the template does.

Example:

```text
Runs an n8n workflow to enrich an IP address and returns a JSON result.
```

### Selection hint

Instruction used to help select the right template.

Example:

```text
Use this template when the user asks to enrich an IP address or when an IP IoC is selected.
```

Example:

```text
Use this template when the user asks to launch the Splunk SOAR triage playbook for a case container.
```

Write the hint as a simple rule. Include the expected target type when it matters.

### Enabled

Defines whether the template can be selected and run.

Disable a template when the remote playbook or workflow is not ready or should no longer be used.

---

### Variables sent by an investigation template

The template fields define how Doko builds the payload sent to the SOAR provider.

The most important values are:

#### Playbook / workflow value

Comes from:

```text
Playbook / workflow name
```

Sent through:

```text
Playbook / workflow API field
```

Example:

```text
Playbook / workflow name: local/doko_ip_enrichment
Playbook / workflow API field: playbook_id
```

Equivalent payload part:

```json
{
  "playbook_id": "local/doko_ip_enrichment"
}
```

#### Target object value

Comes from:

```text
Default target object id
```

or from the runtime context when the value is available.

Sent through:

```text
Target object payload field
```

Example:

```text
Default target object id: 47005
Target object payload field: container_id
```

Equivalent payload part:

```json
{
  "container_id": "47005"
}
```

#### Input value

Comes from the selected IoC, selected asset, command input, or prompt result.

Sent through:

```text
Input payload API field
Input variable name
```

Example:

```text
Input payload API field: inputs
Input variable name: doko_output
```

Equivalent payload part:

```json
{
  "inputs": {
    "doko_output": "8.8.8.8"
  }
}
```

#### Common variable names

Use names that match the remote platform:

| Variable | Meaning | Example value |
|---|---|---|
| `doko_output` | Default value sent by Doko to the remote action | `8.8.8.8` |
| `observable` | Selected indicator or asset | `evil.example` |
| `indicator` | Selected IoC | `203.0.113.10` |
| `target` | Generic selected target | `host01` |
| `container_id` | Splunk SOAR container identifier | `47005` |
| `incident_id` | Incident identifier in the remote platform | `INC-2026-001` |
| `case_id` | Doko case identifier when sent to an external system | `8c6f...` |
| `playbook_id` | Remote playbook identifier | `local/doko_triage` |
| `workflow` | Remote workflow identifier | `doko-enrichment` |

---

## n8n exemple

This example is for an n8n workflow that receives a POST request, runs immediately, and returns the final result in the HTTP response.

### n8n workflow expectation

The n8n webhook should accept a JSON payload similar to:

```json
{
  "workflow": "doko-ioc-enrichment",
  "case_id": "optional-case-id",
  "inputs": {
    "indicator": "8.8.8.8"
  }
}
```

The workflow should return a JSON response similar to:

```json
{
  "status": "success",
  "message": "Indicator enriched successfully",
  "outputs": {
    "reputation": "clean",
    "source": "n8n"
  }
}
```

### SOAR Provider

| Field | Value |
|---|---|
| Name | `n8n Production` |
| Provider kind | `n8n` |
| Timeout seconds | `60` |
| Base URL | `https://n8n.example.com/webhook/doko-investigation` |
| Auth type | `header` |
| Type of authentication token | `X-Doko-Token` |
| Username | leave empty |
| Value of token/password/API key | n8n shared token |
| Enabled | enabled |

### Investigation Template

| Field | Value |
|---|---|
| Name | `Enrich indicator with n8n` |
| Chat command | `/enrich_indicator` |
| SOAR provider | `n8n Production` |
| Playbook / workflow name | `doko-ioc-enrichment` |
| Playbook / workflow API field | `workflow` |
| Target object payload field | `case_id` |
| Input payload API field | `inputs` |
| Input variable name | `indicator` |
| Default target object id | leave empty |
| Description | `Enriches an IoC or asset through n8n and returns the result.` |
| Selection hint | `Use this template when the user asks to enrich an IP, domain, URL, hash, email, host, or selected observable with n8n.` |
| Enabled | enabled |

### Meaning of each variable

| Variable | Meaning |
|---|---|
| `workflow` | Name used by the n8n workflow to identify which action should run. |
| `case_id` | Optional target object identifier. Leave empty if the workflow does not need it. |
| `inputs` | Object containing the value to analyze. |
| `indicator` | The selected IoC, asset, or value extracted from the prompt. |

### Recommended n8n response

Return a compact JSON response:

```json
{
  "status": "success",
  "message": "Analysis completed",
  "outputs": {
    "summary": "No malicious signal found.",
    "score": 0,
    "references": []
  }
}
```

Recommended fields:

| Field | Meaning |
|---|---|
| `status` | `success`, `failed`, or another clear execution state. |
| `message` | Short human-readable result. |
| `outputs` | Main result object. Keep it structured and easy to summarize. |

---

### n8n asynchronous exemple

Use this pattern when the workflow takes too long to return a result immediately.

#### Recommended design

Create two n8n webhooks:

| Webhook | Purpose |
|---|---|
| Start webhook | Receives the request and returns a run identifier quickly. |
| Result webhook | Returns the status and result for the run identifier. |

Example start response:

```json
{
  "status": "running",
  "run_id": "exec-123456"
}
```

Example result response:

```json
{
  "status": "success",
  "message": "Workflow completed",
  "outputs": {
    "summary": "Suspicious activity found."
  }
}
```

#### SOAR Provider

| Field | Value |
|---|---|
| Name | `n8n Async` |
| Provider kind | `n8n` |
| Timeout seconds | `30` |
| Base URL | `https://n8n.example.com/webhook/doko-start` |
| Auth type | `header` |
| Type of authentication token | `X-Doko-Token` |
| Username | leave empty |
| Value of token/password/API key | n8n shared token |
| Enabled | enabled |

#### Investigation Template

| Field | Value |
|---|---|
| Name | `Run long n8n investigation` |
| Chat command | `/n8n_long_investigation` |
| SOAR provider | `n8n Async` |
| Playbook / workflow name | `doko-long-investigation` |
| Playbook / workflow API field | `workflow` |
| Target object payload field | `case_id` |
| Input payload API field | `inputs` |
| Input variable name | `target` |
| Default target object id | leave empty |
| Description | `Starts a longer n8n investigation workflow.` |
| Selection hint | `Use this template when the user asks to run a long investigation workflow in n8n.` |
| Enabled | enabled |

#### Timeout recommendation

The start webhook should return quickly. It should not wait for the full workflow to finish.

Use the workflow itself to store the result and expose a second endpoint if long-running result collection is required.

---

## Splunk SOAR example

This example launches a Splunk SOAR playbook against a container.

### Splunk SOAR expectation

The remote request usually needs:

```json
{
  "playbook_id": "local/doko_ip_enrichment",
  "container_id": 47005,
  "inputs": {
    "observable": "8.8.8.8"
  }
}
```

The exact field names depend on the playbook and Splunk SOAR configuration.

### SOAR Provider

| Field | Value |
|---|---|
| Name | `Splunk SOAR` |
| Provider kind | `splunk_soar` |
| Timeout seconds | `90` |
| Base URL | `https://soar.example.com` |
| Auth type | `header` |
| Type of authentication token | `ph-auth-token` |
| Username | leave empty |
| Value of token/password/API key | Splunk SOAR API token |
| Enabled | enabled |

### Investigation Template

| Field | Value |
|---|---|
| Name | `Run Splunk SOAR IP enrichment` |
| Chat command | `/splunk_ip_enrich` |
| SOAR provider | `Splunk SOAR` |
| Playbook / workflow name | `local/doko_ip_enrichment` |
| Playbook / workflow API field | `playbook_id` |
| Target object payload field | `container_id` |
| Input payload API field | `inputs` |
| Input variable name | `observable` |
| Default target object id | leave empty, or a test container such as `47005` |
| Description | `Runs the Splunk SOAR IP enrichment playbook against a container.` |
| Selection hint | `Use this template when the user asks to enrich an IP address with Splunk SOAR or when an IP IoC is selected.` |
| Enabled | enabled |

### Meaning of each variable

| Variable | Meaning |
|---|---|
| `playbook_id` | Splunk SOAR playbook identifier. Example: `local/doko_ip_enrichment`. |
| `container_id` | Splunk SOAR container where the playbook should run. |
| `inputs` | Object containing values passed to the playbook. |
| `observable` | Selected IoC or asset value sent to the playbook. |

### Recommended playbook output

Return or expose a structured result when possible:

```json
{
  "status": "success",
  "message": "Playbook completed",
  "outputs": {
    "summary": "The IP has low reputation risk.",
    "risk": "low",
    "artifacts_created": 1
  }
}
```

Recommended fields:

| Field | Meaning |
|---|---|
| `status` | Final playbook status. |
| `message` | Short readable status message. |
| `outputs` | Main result returned by the playbook. |

---

### Example configuration: Splunk SOAR case triage playbook

Use this template when the playbook should analyze a full case or container instead of one IoC.

#### SOAR Provider

Reuse the `Splunk SOAR` provider from the previous example.

#### Investigation Template

| Field | Value |
|---|---|
| Name | `Run Splunk SOAR case triage` |
| Chat command | `/splunk_case_triage` |
| SOAR provider | `Splunk SOAR` |
| Playbook / workflow name | `local/doko_case_triage` |
| Playbook / workflow API field | `playbook_id` |
| Target object payload field | `container_id` |
| Input payload API field | `inputs` |
| Input variable name | `doko_output` |
| Default target object id | leave empty |
| Description | `Runs a triage playbook for the selected case container.` |
| Selection hint | `Use this template when the user asks to run a Splunk SOAR triage playbook for a case.` |
| Enabled | enabled |

#### Meaning of each variable

| Variable | Meaning |
|---|---|
| `playbook_id` | Remote playbook to run. |
| `container_id` | Target Splunk SOAR container. |
| `inputs` | Additional playbook input values. |
| `doko_output` | Prompt output or selected runtime value passed to the playbook. |

---

## Field names

Use the field names expected by the remote platform.

### For Splunk SOAR

Common values:

| Doko field | Recommended value |
|---|---|
| Playbook / workflow API field | `playbook_id` |
| Target object payload field | `container_id` |
| Input payload API field | `inputs` |
| Input variable name | `observable`, `doko_output`, or the playbook input name |

Use the exact input name defined by the playbook.

### For n8n

Common values:

| Doko field | Recommended value |
|---|---|
| Playbook / workflow API field | `workflow` or `workflow_name` |
| Target object payload field | `case_id`, `incident_id`, or `container_id` |
| Input payload API field | `inputs`, `payload`, or `data` |
| Input variable name | `target`, `indicator`, `observable`, or `doko_output` |

The n8n workflow should read these fields from the incoming webhook body.

---

## Troubleshooting

### The assistant cannot run an investigation template

Check:

- The LLM provider is enabled.
- The SOAR provider is enabled.
- The investigation template is enabled.
- The template has a selected SOAR provider.
- The chat command is unique and starts with `/`.

### The remote platform returns an authentication error

Check:

- The selected auth type.
- The token header name.
- The token value.
- Whether the remote platform expects a bearer token instead of a custom header.

### The remote platform receives an empty or unusable payload

Check:

- Playbook / workflow API field.
- Target object payload field.
- Input payload API field.
- Input variable name.
- Whether the selected IoC, asset, case, alert, or hunt actually provides the expected value.

### The request times out

Check:

- The SOAR provider timeout.
- Whether the remote workflow is synchronous or asynchronous.
- Whether the remote platform can return a run identifier quickly instead of waiting for a long execution to finish.

### The wrong investigation template is selected

Check:

- The template description.
- The selection hint.
- The chat command.
- Whether multiple templates have very similar names or hints.

---

## Recommended patterns

### One SOAR provider, several templates

Use one provider per platform/environment.

Example:

```text
SOAR provider: n8n Production
Template 1: Enrich IP
Template 2: Enrich domain
Template 3: Summarize case
Template 4: Run long investigation
```

This keeps authentication and endpoint configuration centralized.

### One template per clear action

Avoid a single template that tries to do everything.

Prefer:

```text
/enrich_ip
/enrich_domain
/enrich_hash
/summarize_case
/run_case_triage
```

Instead of:

```text
/run_everything
```

### Use explicit commands for important actions

For actions that launch remote workflows, define a chat command.

Example:

```text
/splunk_case_triage
```

This makes the action easier to trigger intentionally.

### Keep output structured

Remote workflows should return JSON that is easy to read and summarize.

Recommended shape:

```json
{
  "status": "success",
  "message": "Short human-readable result",
  "outputs": {
    "summary": "Main result",
    "risk": "low",
    "items": []
  }
}
```

Avoid returning only long text when a structured JSON result is possible.
