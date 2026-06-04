## Table of contents

- [Case Reports](#case-reports)
- [Template settings](#template-settings)
- [Template rendering](#template-rendering)
- [Available fields](#available-fields)
- [Filters and helpers](#filters-and-helpers)
- [Writing HTML templates](#writing-html-templates)
- [Writing CSS](#writing-css)
- [Previewing a template](#previewing-a-template)
- [Generating a report](#generating-a-report)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Recommended patterns](#recommended-patterns)


## Case Reports

Case reports are generated from HTML and CSS templates.

A report template defines:

- metadata used to identify the template
- the HTML structure of the report
- the CSS used for layout and print rendering
- dynamic values inserted from the selected case

Reports are generated as PDF files from a case.

A template can include:

- case metadata
- case description
- IoCs
- assets
- linked alerts
- workbook items
- comments
- attachments
- activity timeline
- incident timeline
- Exchange messages
- custom parameters

Use templates to create consistent exports such as:

- investigation summary
- incident report
- customer report
- analyst handover
- escalation report
- closure report

---

## Template settings

### Name

Display name of the report template.

Example:

```text
Customer incident report
```

Use a short name that clearly describes the report purpose.

### Description

Short explanation of what the template is used for.

Example:

```text
Standard customer-facing incident report with case summary, IoCs, assets, timeline and conclusion.
```

The description should help users choose the right template when generating a report.

### Template status

Defines whether the template is active.

Available values:

```text
Active
Inactive
```

Only active templates should be used for new reports.

Disable a template when it should no longer be used, while keeping it available for review.

### HTML

Main report structure written with Jinja2 syntax.

The HTML controls:

- titles
- sections
- tables
- conditions
- loops
- inserted case values

Example:

```html
<h1>{{ case.title }}</h1>
<p>Status: {{ case.status }}</p>
```

### CSS

Optional styling applied to the generated report.

The CSS controls:

- page size
- margins
- typography
- tables
- cards
- print layout

Example:

```css
@page {
  size: A4;
  margin: 16mm 14mm;
}

body {
  font-family: Inter, Arial, sans-serif;
  font-size: 11.5px;
}
```

---

## Template rendering

Templates use Jinja2 syntax.

Common Jinja2 patterns are supported:

### Print a value

```jinja2
{{ case.title }}
```

### Use a fallback value

```jinja2
{{ case.severity or "-" }}
```

### Conditional section

```jinja2
{% if case.iocs %}
<section>
  <h2>Indicators of Compromise</h2>
</section>
{% endif %}
```

### Loop over a list

```jinja2
{% for row in case.iocs %}
  <tr>
    <td>{{ row.get('value') or '-' }}</td>
  </tr>
{% endfor %}
```

### Read JSON rows safely

IoCs and assets are JSON rows. Use `.get(...)` instead of direct dotted access.

Recommended:

```jinja2
{{ row.get('value') or '-' }}
```

Avoid:

```jinja2
{{ row.value }}
```

Undefined variables raise an error. Use fallbacks and `.get(...)` when a value may be missing.

---

## Available fields

### Case fields

| Field | Example | Meaning |
|---|---|---|
| `case.id` | `{{ case.id }}` | Case UUID. |
| `case.case_number` | `{{ case.case_number or '' }}` | Case number, when available. |
| `case.title` | `{{ case.title }}` | Case title. |
| `case.description` | `{{ case.description|safe }}` | Case description stored as HTML. |
| `case.status` | `{{ case.status or '-' }}` | Case status. |
| `case.severity` | `{{ case.severity or '-' }}` | Case severity. |
| `case.classification` | `{{ case.classification or '-' }}` | Case classification. |
| `case.outcome` | `{{ case.outcome or '-' }}` | Case outcome. |
| `case.created_at` | `{{ case.created_at|format_date }}` | Case creation datetime. |
| `case.updated_at` | `{{ case.updated_at|format_date }}` | Case last update datetime. |
| `case.archived_at` | `{{ case.archived_at|format_date if case.archived_at else '' }}` | Case archive datetime, when archived. |
| `case.unarchived_at` | `{{ case.unarchived_at|format_date if case.unarchived_at else '' }}` | Case unarchive datetime, when available. |
| `case.customer` | `{{ case.customer.name if case.customer else '-' }}` | Customer attached to the case. |
| `case.customer_id` | `{{ case.customer_id or '' }}` | Customer UUID. |
| `case.owner` | `{{ case.owner.username if case.owner else '-' }}` | Case owner. |
| `case.owner_id` | `{{ case.owner_id or '' }}` | Case owner identifier. |
| `case.iocs` | `{% for row in case.iocs %}...{% endfor %}` | IoCs stored on the case. |
| `case.assets` | `{% for row in case.assets %}...{% endfor %}` | Assets stored on the case. |

### IoC and asset row fields

IoCs and assets are stored as JSON rows.

Common row fields:

| Field | Example | Meaning |
|---|---|---|
| `row.get('key')` | `{{ row.get('key') or '-' }}` | Row key, when present. |
| `row.get('field')` | `{{ row.get('field') or '-' }}` | Alternate row key, when present. |
| `row.get('type')` | `{{ row.get('type') or '-' }}` | Observable type, when present. |
| `row.get('kind')` | `{{ row.get('kind') or '-' }}` | Observable kind, when present. |
| `row.get('value')` | `{{ row.get('value') or '-' }}` | Observable value. |
| `row.get('status')` | `{{ row.get('status') or '-' }}` | Observable status, when present. |
| `row.get('state')` | `{{ row.get('state') or '-' }}` | Alternate status field, when present. |

Recommended display pattern:

```jinja2
{{ row.get('key') or row.get('field') or row.get('type') or row.get('kind') or '-' }}
```

Recommended status pattern:

```jinja2
{{ row.get('status') or row.get('state') or '-' }}
```

### Workbook fields

| Field | Example | Meaning |
|---|---|---|
| `workbook` | `{% if workbook %}...{% endif %}` | Workbook attached to the case, or empty if none exists. |
| `workbook.template` | `{{ workbook.template.name if workbook and workbook.template else '' }}` | Workbook template used by the case. |
| `workbook.items` | `{% for it in workbook.items.all() %}...{% endfor %}` | Workbook items. |
| `it.label` | `{{ it.label }}` | Workbook item label. |
| `it.is_done` | `{{ "Yes" if it.is_done else "No" }}` | Workbook item state. |
| `it.order` | `{{ it.order }}` | Workbook item order. |

Use `workbook.items.all()` inside loops.

Example:

```jinja2
{% if workbook and workbook.items %}
  {% for it in workbook.items.all() %}
    <p>{{ "✓" if it.is_done else "" }} {{ it.label }}</p>
  {% endfor %}
{% endif %}
```

### Linked alerts

| Field | Example | Meaning |
|---|---|---|
| `linked_alerts` | `{% for a in linked_alerts %}...{% endfor %}` | Alerts linked to the case. |
| `a.id` | `{{ a.id }}` | Alert UUID. |
| `a.title` | `{{ a.title }}` | Alert title. |
| `a.status` | `{{ a.status or '-' }}` | Alert status. |
| `a.severity` | `{{ a.severity or '-' }}` | Alert severity. |
| `a.classification` | `{{ a.classification or '-' }}` | Alert classification. |
| `a.description` | `{{ a.description or '' }}` | Alert description. |
| `a.source` | `{{ a.source or '' }}` | Alert source. |
| `a.created_at` | `{{ a.created_at|format_date }}` | Alert creation datetime. |

### Comments

| Field | Example | Meaning |
|---|---|---|
| `comments` | `{% for c in comments %}...{% endfor %}` | Case comments. |
| `c.text` | `{{ c.text|safe }}` | Comment body. |
| `c.author` | `{{ c.author.username if c.author else c.author_label }}` | Comment author. |
| `c.author_label` | `{{ c.author_label or '' }}` | Label used when no user author exists. |
| `c.created_at` | `{{ c.created_at|format_date }}` | Comment creation datetime. |
| `c.updated_at` | `{{ c.updated_at|format_date }}` | Comment last update datetime. |

Use `|safe` only when the comment content should be rendered as HTML.

### Attachments

| Field | Example | Meaning |
|---|---|---|
| `attachments` | `{% for f in attachments %}...{% endfor %}` | Case attachments. |
| `f.id` | `{{ f.id }}` | Attachment UUID. |
| `f.original_name` | `{{ f.original_name or '-' }}` | Original file name. |
| `f.file` | `{{ f.file }}` | Stored file value. |
| `f.uploaded_by` | `{{ f.uploaded_by.username if f.uploaded_by else '-' }}` | User who uploaded the file. |
| `f.created_at` | `{{ f.created_at|format_date }}` | Upload datetime. |

### Activity timeline

| Field | Example | Meaning |
|---|---|---|
| `timeline` | `{% for t in timeline %}...{% endfor %}` | Case activity timeline. |
| `t.date` | `{{ t.date|format_date }}` | Timeline date. |
| `t.type` | `{{ t.type or '-' }}` | Timeline item type. |
| `t.text` | `{{ t.text|safe }}` | Timeline content. |
| `t.actor` | `{{ t.actor.username if t.actor else '-' }}` | User associated with the item. |
| `t.alert` | `{{ t.alert.title if t.alert else '' }}` | Linked alert, when present. |
| `t.created_at` | `{{ t.created_at|format_date }}` | Creation datetime. |
| `t.updated_at` | `{{ t.updated_at|format_date }}` | Last update datetime. |

### Incident timeline

| Field | Example | Meaning |
|---|---|---|
| `incident_timeline` | `{% for item in incident_timeline %}...{% endfor %}` | Visual incident timeline items. |
| `item.occurred_at` | `{{ item.occurred_at|format_date }}` | Event occurrence datetime. |
| `item.title` | `{{ item.title }}` | Timeline event title. |
| `item.details` | `{{ item.details|safe }}` | Timeline event details. |
| `item.kind` | `{{ item.kind or '-' }}` | Event kind. |
| `item.severity` | `{{ item.severity or '-' }}` | Event severity. |
| `item.source` | `{{ item.source or '-' }}` | Event source. |
| `item.created_by` | `{{ item.created_by.username if item.created_by else '-' }}` | User who created the event. |

### Exchanges

| Field | Example | Meaning |
|---|---|---|
| `exchanges` | `{% for e in exchanges %}...{% endfor %}` | Exchange messages linked to the case. |
| `e.direction` | `{{ e.direction }}` | `inbound` or `outbound`. |
| `e.channel` | `{{ e.channel or '-' }}` | Exchange channel. |
| `e.subject` | `{{ e.subject or '-' }}` | Message subject. |
| `e.body` | `{{ e.body|safe }}` | Message body. |
| `e.sender` | `{{ e.sender or '-' }}` | Sender. |
| `e.to` | `{{ e.to|tojson }}` | Recipients. |
| `e.cc` | `{{ e.cc|tojson }}` | CC recipients. |
| `e.bcc` | `{{ e.bcc|tojson }}` | BCC recipients. |
| `e.message_id` | `{{ e.message_id or '' }}` | Message identifier, when present. |
| `e.created_by` | `{{ e.created_by.username if e.created_by else '-' }}` | User who created the Exchange. |
| `e.created_at` | `{{ e.created_at|format_date }}` | Exchange creation datetime. |

### Generation fields

| Field | Example | Meaning |
|---|---|---|
| `generated_at` | `{{ generated_at|format_date }}` | Report preview or generation datetime. |
| `generated_by.username` | `{{ generated_by.username }}` | User who generated or previewed the report. |
| `generated_by.email` | `{{ generated_by.email or '' }}` | Email of the user who generated or previewed the report. |

### Custom parameters

| Field | Example | Meaning |
|---|---|---|
| `params` | `{{ params|tojson }}` | Custom parameter object sent during preview or generation. |
| `params.get('key')` | `{{ params.get('report_title', '') }}` | Safe way to read a custom parameter. |
| `params.some_key` | `{{ params.report_title or '' }}` | Alternate dotted access when the key exists. |

Prefer `params.get(...)` because missing values are safer to handle.

Example:

```jinja2
<h1>{{ params.get('report_title', case.title) }}</h1>
```

---

## Filters and helpers

### `format_date`

Formats a date or datetime value.

Example:

```jinja2
{{ case.created_at|format_date }}
```

Use this for case dates, alert dates, timeline dates, comments, attachments and generation time.

### `safe`

Renders HTML content as HTML.

Example:

```jinja2
{{ case.description|safe }}
```

Use it for content already stored as HTML, such as rich descriptions and message bodies.

Do not use it for untrusted custom parameter values.

### `nl2br`

Converts plain text line breaks to `<br>`.

Example:

```jinja2
{{ params.get('analyst_note', '')|nl2br }}
```

Use it for plain text content.

Do not use it on the case description if the description already contains HTML.

### `tojson`

Renders a value as JSON.

Example:

```jinja2
<pre>{{ params|tojson }}</pre>
```

Useful for debug sections or structured appendices.

---

## Writing HTML templates

### Start with a simple structure

Use sections and tables.

Example:

```html
<div class="report">
  <h1>{{ case.title }}</h1>

  <section>
    <h2>Summary</h2>
    <div>{{ case.description|safe }}</div>
  </section>
</div>
```

### Protect optional sections

Use `{% if ... %}` before rendering optional collections.

Example:

```jinja2
{% if linked_alerts %}
<section>
  <h2>Linked alerts</h2>
</section>
{% endif %}
```

### Use tables for repeated data

Example:

```jinja2
<table>
  <thead>
    <tr>
      <th>Type</th>
      <th>Value</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    {% for row in case.iocs %}
    <tr>
      <td>{{ row.get('key') or row.get('field') or row.get('type') or '-' }}</td>
      <td>{{ row.get('value') or '-' }}</td>
      <td>{{ row.get('status') or row.get('state') or '-' }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>
```

### Avoid unsafe assumptions

Avoid direct access to fields that may not exist.

Recommended:

```jinja2
{{ row.get('value') or '-' }}
```

Not recommended:

```jinja2
{{ row.value }}
```

---

## Writing CSS

### Page setup

Use `@page` for PDF layout.

```css
@page {
  size: A4;
  margin: 16mm 14mm;
}
```

### Base typography

```css
body {
  font-family: Inter, Arial, sans-serif;
  font-size: 11.5px;
  line-height: 1.5;
  color: #0f172a;
}
```

### Tables

```css
table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 7px 6px;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
}
```

### Avoid fragile layouts

For PDF output, prefer:

- simple block layout
- tables for tabular data
- inline-block or table-cell for cards
- fixed page margins

Avoid relying on interactive behavior, external scripts, or browser-only layout features.

---

## Previewing a template

Use preview before saving or using a template for real reports.

Preview requires a case UUID.

Preview renders the current HTML and CSS against the selected case and displays the result without generating a PDF report instance.

Use preview to validate:

- field names
- loops
- optional sections
- CSS layout
- page size
- table rendering
- missing values

If the preview fails, the error usually points to the template expression that could not be rendered.

---

## Generating a report

A report is generated from an active template and a selected case.

When the report is generated:

- the template HTML is rendered with the case context
- the template CSS is applied
- a PDF file is created
- the generated report keeps a snapshot of the template name, version, HTML and CSS
- a case timeline entry is added

Generated reports are attached to the case report history.

---

## Examples

### Example: minimal case summary

Use this template for a compact internal report.

#### HTML

```html
<div class="report">
  <h1>{{ case.title }}</h1>

  <table>
    <tr>
      <th>Status</th>
      <td>{{ case.status or "-" }}</td>
    </tr>
    <tr>
      <th>Severity</th>
      <td>{{ case.severity or "-" }}</td>
    </tr>
    <tr>
      <th>Classification</th>
      <td>{{ case.classification or "-" }}</td>
    </tr>
    <tr>
      <th>Customer</th>
      <td>{{ case.customer.name if case.customer else "-" }}</td>
    </tr>
    <tr>
      <th>Owner</th>
      <td>{{ case.owner.username if case.owner else "-" }}</td>
    </tr>
  </table>

  <h2>Description</h2>
  <div>{{ case.description|safe }}</div>

  <footer>
    Generated {{ generated_at|format_date }} by {{ generated_by.username }}
  </footer>
</div>
```

#### CSS

```css
@page {
  size: A4;
  margin: 16mm;
}

body {
  font-family: Arial, sans-serif;
  font-size: 12px;
  color: #111827;
}

h1 {
  font-size: 22px;
  margin-bottom: 12px;
}

h2 {
  margin-top: 22px;
  font-size: 15px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 18px;
}

th,
td {
  text-align: left;
  padding: 7px;
  border-bottom: 1px solid #e5e7eb;
}

footer {
  margin-top: 28px;
  font-size: 10px;
  color: #6b7280;
}
```

---

### Example: case report with IoCs and assets

Use this template when the report must include observables.

#### HTML

```html
<div class="report">
  <header class="hero">
    <div>
      <div class="eyebrow">Doko Case Report</div>
      <h1>{{ case.title }}</h1>
      <p>Case {{ case.case_number or case.id }}</p>
    </div>
  </header>

  <section class="cards">
    <div class="card">
      <div class="label">Status</div>
      <div class="value">{{ case.status or "-" }}</div>
    </div>
    <div class="card">
      <div class="label">Severity</div>
      <div class="value">{{ case.severity or "-" }}</div>
    </div>
    <div class="card">
      <div class="label">Classification</div>
      <div class="value">{{ case.classification or "-" }}</div>
    </div>
    <div class="card">
      <div class="label">Outcome</div>
      <div class="value">{{ case.outcome or "-" }}</div>
    </div>
  </section>

  <section>
    <h2>Description</h2>
    <div class="surface">{{ case.description|safe }}</div>
  </section>

  {% if case.iocs %}
  <section>
    <h2>Indicators of Compromise</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Value</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {% for row in case.iocs %}
        <tr>
          <td>{{ row.get('key') or row.get('field') or row.get('type') or "-" }}</td>
          <td class="mono">{{ row.get('value') or "-" }}</td>
          <td>{{ row.get('status') or row.get('state') or "-" }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </section>
  {% endif %}

  {% if case.assets %}
  <section>
    <h2>Assets</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Value</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {% for row in case.assets %}
        <tr>
          <td>{{ row.get('key') or row.get('field') or row.get('type') or "-" }}</td>
          <td class="mono">{{ row.get('value') or "-" }}</td>
          <td>{{ row.get('status') or row.get('state') or "-" }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </section>
  {% endif %}

  <footer>
    Generated {{ generated_at|format_date }}
  </footer>
</div>
```

#### CSS

```css
@page {
  size: A4;
  margin: 14mm;
}

body {
  font-family: Inter, Arial, sans-serif;
  font-size: 11.5px;
  color: #0f172a;
}

.hero {
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  margin-bottom: 18px;
}

.eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: #64748b;
}

h1 {
  margin: 6px 0 0;
  font-size: 24px;
}

.cards {
  font-size: 0;
  margin-bottom: 20px;
}

.card {
  display: inline-block;
  width: calc(25% - 9px);
  margin-right: 12px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-sizing: border-box;
  vertical-align: top;
}

.card:nth-child(4n) {
  margin-right: 0;
}

.label {
  font-size: 10px;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 4px;
}

.value {
  font-size: 12px;
  font-weight: 700;
}

.surface {
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

th,
td {
  padding: 8px 6px;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
}

.mono {
  font-family: Consolas, Menlo, monospace;
  word-break: break-word;
}

footer {
  margin-top: 28px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
  text-align: right;
  color: #64748b;
  font-size: 10px;
}
```

---

### Example: customer-facing incident report

Use this template for a more complete report with timeline, linked alerts and conclusion.

This example uses `params` for values that are not stored directly on the case.

Suggested parameters:

```json
{
  "executive_summary": "Short customer-facing summary.",
  "impact": "No confirmed business impact.",
  "root_cause": "Suspicious authentication activity.",
  "recommendation": "Reset the affected password and review MFA enrollment."
}
```

#### HTML

```html
<div class="report">
  <header class="hero">
    <div class="eyebrow">Incident Report</div>
    <h1>{{ params.get('report_title', case.title) }}</h1>
    <p>
      Customer:
      <strong>{{ case.customer.name if case.customer else "-" }}</strong>
      · Generated {{ generated_at|format_date }}
    </p>
  </header>

  <section class="grid">
    <div class="box">
      <div class="label">Status</div>
      <div class="value">{{ case.status or "-" }}</div>
    </div>
    <div class="box">
      <div class="label">Severity</div>
      <div class="value">{{ case.severity or "-" }}</div>
    </div>
    <div class="box">
      <div class="label">Classification</div>
      <div class="value">{{ case.classification or "-" }}</div>
    </div>
    <div class="box">
      <div class="label">Outcome</div>
      <div class="value">{{ case.outcome or "-" }}</div>
    </div>
  </section>

  <section>
    <h2>Executive summary</h2>
    <div class="surface">
      {{ params.get('executive_summary', '')|nl2br }}
    </div>
  </section>

  <section>
    <h2>Case description</h2>
    <div class="surface prose">
      {{ case.description|safe }}
    </div>
  </section>

  <section>
    <h2>Impact</h2>
    <div class="surface">
      {{ params.get('impact', '-')|nl2br }}
    </div>
  </section>

  {% if incident_timeline %}
  <section>
    <h2>Incident timeline</h2>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Severity</th>
          <th>Event</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {% for item in incident_timeline %}
        <tr>
          <td>{{ item.occurred_at|format_date }}</td>
          <td>{{ item.severity or '-' }}</td>
          <td>{{ item.title }}</td>
          <td>{{ item.details|safe }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </section>
  {% endif %}

  {% if linked_alerts %}
  <section>
    <h2>Linked alerts</h2>
    <table>
      <thead>
        <tr>
          <th>Created</th>
          <th>Title</th>
          <th>Severity</th>
          <th>Status</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {% for a in linked_alerts %}
        <tr>
          <td>{{ a.created_at|format_date }}</td>
          <td>{{ a.title }}</td>
          <td>{{ a.severity or '-' }}</td>
          <td>{{ a.status or '-' }}</td>
          <td>{{ a.source or '-' }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </section>
  {% endif %}

  {% if case.iocs %}
  <section>
    <h2>Indicators</h2>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Value</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {% for row in case.iocs %}
        <tr>
          <td>{{ row.get('key') or row.get('field') or row.get('type') or '-' }}</td>
          <td class="mono">{{ row.get('value') or '-' }}</td>
          <td>{{ row.get('status') or row.get('state') or '-' }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </section>
  {% endif %}

  <section>
    <h2>Root cause</h2>
    <div class="surface">{{ params.get('root_cause', '-')|nl2br }}</div>
  </section>

  <section>
    <h2>Recommendations</h2>
    <div class="surface">{{ params.get('recommendation', '-')|nl2br }}</div>
  </section>
</div>
```

#### CSS

```css
@page {
  size: A4;
  margin: 15mm 14mm;
}

body {
  font-family: Inter, Arial, sans-serif;
  font-size: 11px;
  line-height: 1.5;
  color: #0f172a;
}

.hero {
  padding: 18px;
  border: 1px solid #dbe3ef;
  border-radius: 16px;
  background: #f8fafc;
}

.eyebrow {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .14em;
  color: #64748b;
  font-weight: 700;
}

h1 {
  margin: 6px 0;
  font-size: 25px;
}

h2 {
  margin: 22px 0 8px;
  font-size: 15px;
}

.grid {
  font-size: 0;
  margin: 18px 0;
}

.box {
  display: inline-block;
  width: calc(25% - 9px);
  margin-right: 12px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-sizing: border-box;
  vertical-align: top;
}

.box:nth-child(4n) {
  margin-right: 0;
}

.label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: #64748b;
}

.value {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
}

.surface {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 11px 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

th {
  text-align: left;
  font-size: 9px;
  text-transform: uppercase;
  color: #64748b;
  padding: 7px 5px;
  border-bottom: 1px solid #cbd5e1;
}

td {
  padding: 8px 5px;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
}

.mono {
  font-family: Consolas, Menlo, monospace;
  word-break: break-word;
}
```

---

### Example: full internal report

Use this template for a complete internal export with comments, attachments, workbook, activity timeline and Exchanges.

#### HTML

```html
<div class="report">

  <header class="cover">
    <div class="cover-bar"></div>

    <div class="cover-content">
      <div class="cover-main">
        <div class="eyebrow">Doko Case Report</div>

        <h1>{{ case.title or "Untitled case" }}</h1>

        <div class="case-ref">
          {% if case.case_number %}
            Case ID#{{ case.case_number }}
          {% else %}
            Case UUID {{ case.id }}
          {% endif %}
        </div>

        <div class="cover-meta-line">
          Generated {{ generated_at|format_date }}
          {% if generated_by %} by {{ generated_by.username }}{% endif %}
        </div>
      </div>

      <div class="cover-side">
        <div class="score-card">
          <div class="score-label">Outcome</div>
          <div class="score-value badge outcome-{{ case.outcome or 'unknown' }}">
            {{ case.outcome or "Unknown" }}
          </div>
        </div>

        <div class="score-card">
          <div class="score-label">Severity</div>
          <div class="score-value badge severity-{{ case.severity or 'unknown' }}">
            {{ case.severity or "-" }}
          </div>
        </div>
      </div>
    </div>
  </header>

  <section class="section compact">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Overview</div>
        <h2>Executive summary</h2>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Status</div>
        <div class="summary-value badge status-{{ case.status or 'unknown' }}">{{ case.status or "-" }}</div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Classification</div>
        <div class="summary-value">{{ case.classification or "-" }}</div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Customer</div>
        <div class="summary-value">
          {% if case.customer %}{{ case.customer.name }}{% else %}-{% endif %}
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Owner</div>
        <div class="summary-value">
          {% if case.owner %}{{ case.owner.username }}{% else %}-{% endif %}
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Created</div>
        <div class="summary-value">{{ case.created_at|format_date }}</div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Last update</div>
        <div class="summary-value">{{ case.updated_at|format_date }}</div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Case UUID</div>
        <div class="summary-value mono break-anywhere">{{ case.id }}</div>
      </div>

      <div class="summary-card">
        <div class="summary-label">Report scope</div>
        <div class="summary-value">Full case export</div>
      </div>
    </div>

    <div class="metric-row">
      <div class="metric-card">
        <div class="metric-number">{{ case.iocs|length if case.iocs else 0 }}</div>
        <div class="metric-label">IoCs</div>
      </div>

      <div class="metric-card">
        <div class="metric-number">{{ case.assets|length if case.assets else 0 }}</div>
        <div class="metric-label">Assets</div>
      </div>

      <div class="metric-card">
        <div class="metric-number">{{ linked_alerts|length if linked_alerts else 0 }}</div>
        <div class="metric-label">Alerts</div>
      </div>

      <div class="metric-card">
        <div class="metric-number">{{ exchanges|length if exchanges else 0 }}</div>
        <div class="metric-label">Exchanges</div>
      </div>

      <div class="metric-card">
        <div class="metric-number">{{ comments|length if comments else 0 }}</div>
        <div class="metric-label">Comments</div>
      </div>

      <div class="metric-card">
        <div class="metric-number">{{ attachments|length if attachments else 0 }}</div>
        <div class="metric-label">Attachments</div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Case narrative</div>
        <h2>Description</h2>
      </div>
    </div>

    <div class="surface prose-block">
      {% if case.description %}
        {{ case.description|safe }}
      {% else %}
        <p class="empty">No description provided.</p>
      {% endif %}
    </div>
  </section>

  {% if case.iocs %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Observables</div>
        <h2>Indicators of Compromise</h2>
      </div>
      <div class="section-count">{{ case.iocs|length }} item(s)</div>
    </div>

    <div class="surface no-padding">
      <table>
        <thead>
          <tr>
            <th class="w-22">Type</th>
            <th>Value</th>
            <th class="w-22">Status</th>
          </tr>
        </thead>
        <tbody>
          {% for row in case.iocs %}
          <tr>
            <td>{{ row.get('type') or row.get('key') or row.get('field') or "-" }}</td>
            <td class="mono break-anywhere strong">{{ row.get('value') or "-" }}</td>
            <td>{{ row.get('status') or row.get('state') or "-" }}</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if case.assets %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Impacted scope</div>
        <h2>Assets</h2>
      </div>
      <div class="section-count">{{ case.assets|length }} item(s)</div>
    </div>

    <div class="surface no-padding">
      <table>
        <thead>
          <tr>
            <th class="w-22">Type</th>
            <th>Value</th>
            <th class="w-22">Status</th>
          </tr>
        </thead>
        <tbody>
          {% for row in case.assets %}
          <tr>
            <td>{{ row.get('type') or row.get('key') or row.get('field') or "-" }}</td>
            <td class="mono break-anywhere strong">{{ row.get('value') or "-" }}</td>
            <td>{{ row.get('status') or row.get('state') or "-" }}</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if linked_alerts %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Correlation</div>
        <h2>Linked alerts</h2>
      </div>
      <div class="section-count">{{ linked_alerts|length }} alert(s)</div>
    </div>

    <div class="surface no-padding">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th class="w-20">Status</th>
            <th class="w-20">Severity</th>
            <th class="w-24">Classification</th>
            <th class="w-24">Created</th>
          </tr>
        </thead>
        <tbody>
          {% for a in linked_alerts %}
          <tr>
            <td class="strong break-anywhere">{{ a.title or "-" }}</td>
            <td>{{ a.status or "-" }}</td>
            <td>{{ a.severity or "-" }}</td>
            <td>{{ a.classification or "-" }}</td>
            <td>{{ a.created_at|format_date }}</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if workbook and workbook.items %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Investigation tracking</div>
        <h2>Workbook</h2>
      </div>
    </div>

    <div class="surface no-padding">
      <table>
        <thead>
          <tr>
            <th class="w-16 center">Done</th>
            <th>Item</th>
            <th class="w-16 center">Order</th>
          </tr>
        </thead>
        <tbody>
          {% for it in workbook.items.all() %}
          <tr>
            <td class="center">
              <span class="check {{ 'is-done' if it.is_done else 'is-open' }}">
                {{ "Yes" if it.is_done else "No" }}
              </span>
            </td>
            <td class="break-anywhere">{{ it.label }}</td>
            <td class="center">{{ it.order if it.order is not none else "-" }}</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if incident_timeline %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Incident chronology</div>
        <h2>Incident timeline</h2>
      </div>
      <div class="section-count">{{ incident_timeline|length }} event(s)</div>
    </div>

    <div class="timeline">
      {% for item in incident_timeline %}
      <div class="timeline-entry">
        <div class="timeline-dot"></div>
        <div class="timeline-card">
          <div class="timeline-meta">
            {{ item.occurred_at|format_date }}
            {% if item.source %} · {{ item.source }}{% endif %}
            {% if item.severity %} · {{ item.severity }}{% endif %}
          </div>
          <div class="timeline-title break-anywhere">{{ item.title or "-" }}</div>
          {% if item.details %}
          <div class="timeline-body prose-block">{{ item.details|safe }}</div>
          {% endif %}
        </div>
      </div>
      {% endfor %}
    </div>
  </section>
  {% endif %}

  {% if timeline %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Case activity</div>
        <h2>Activity log</h2>
      </div>
      <div class="section-count">{{ timeline|length }} item(s)</div>
    </div>

    <div class="surface no-padding">
      <table>
        <thead>
          <tr>
            <th class="w-24">Date</th>
            <th class="w-24">Type</th>
            <th>Details</th>
            <th class="w-22">Actor</th>
          </tr>
        </thead>
        <tbody>
          {% for item in timeline %}
          <tr>
            <td>{{ item.date|format_date }}</td>
            <td>{{ item.type or "-" }}</td>
            <td class="break-anywhere">{{ item.text or "-" }}</td>
            <td>
              {% if item.actor %}{{ item.actor.username }}{% else %}-{% endif %}
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if comments %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Analyst notes</div>
        <h2>Comments</h2>
      </div>
      <div class="section-count">{{ comments|length }} comment(s)</div>
    </div>

    <div class="stack">
      {% for c in comments %}
      <article class="message-card">
        <div class="message-head">
          <div class="message-title">
            {% if c.author %}{{ c.author.username }}{% else %}{{ c.author_label or "Unknown" }}{% endif %}
          </div>
          <div class="message-date">{{ c.created_at|format_date }}</div>
        </div>
        <div class="message-body prose-block">{{ c.text|safe }}</div>
      </article>
      {% endfor %}
    </div>
  </section>
  {% endif %}

  {% if exchanges %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Communications</div>
        <h2>Case exchanges</h2>
      </div>
      <div class="section-count">{{ exchanges|length }} exchange(s)</div>
    </div>

    <div class="stack">
      {% for e in exchanges %}
      <article class="exchange-card {{ 'exchange-inbound' if e.direction == 'inbound' else 'exchange-outbound' }}">
        <div class="exchange-head">
          <div>
            <div class="exchange-direction">{{ e.direction or "-" }} · {{ e.channel or "-" }}</div>
            <div class="exchange-subject break-anywhere">{{ e.subject or "(no subject)" }}</div>
          </div>
          <div class="exchange-date">{{ e.created_at|format_date }}</div>
        </div>

        <div class="exchange-meta">
          <div><strong>From:</strong> <span class="break-anywhere">{{ e.sender or "-" }}</span></div>
          <div><strong>To:</strong> <span class="break-anywhere">{{ e.to|join(', ') if e.to else "-" }}</span></div>
          {% if e.cc %}
          <div><strong>Cc:</strong> <span class="break-anywhere">{{ e.cc|join(', ') }}</span></div>
          {% endif %}
          {% if e.message_id %}
          <div><strong>Message-ID:</strong> <span class="mono break-anywhere">{{ e.message_id }}</span></div>
          {% endif %}
        </div>

        {% if e.body %}
        <div class="exchange-body prose-block">{{ e.body|safe }}</div>
        {% endif %}
      </article>
      {% endfor %}
    </div>
  </section>
  {% endif %}

  {% if attachments %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Evidence</div>
        <h2>Attachments</h2>
      </div>
      <div class="section-count">{{ attachments|length }} file(s)</div>
    </div>

    <div class="surface no-padding">
      <table>
        <thead>
          <tr>
            <th>Filename</th>
            <th class="w-24">Uploaded</th>
            <th class="w-24">Uploaded by</th>
          </tr>
        </thead>
        <tbody>
          {% for f in attachments %}
          <tr>
            <td class="break-anywhere strong">{{ f.original_name or f.file.name or "-" }}</td>
            <td>{{ f.created_at|format_date }}</td>
            <td>
              {% if f.uploaded_by %}{{ f.uploaded_by.username }}{% else %}-{% endif %}
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </section>
  {% endif %}

  {% if params %}
  <section class="section">
    <div class="section-title-row">
      <div>
        <div class="section-kicker">Template inputs</div>
        <h2>Custom parameters</h2>
      </div>
    </div>

    <div class="surface">
      <pre class="json-block">{{ params|tojson }}</pre>
    </div>
  </section>
  {% endif %}

  <footer class="footer">
    <div>Doko Case Report</div>
    <div>
      Generated {{ generated_at|format_date }}
      {% if generated_by %} · {{ generated_by.username }}{% endif %}
    </div>
  </footer>

</div>
```

#### CSS

```css
@page {
  size: A4;
  margin: 14mm 12mm 16mm;
}

:root {
  --ink: #0f172a;
  --muted: #475569;
  --muted-soft: #64748b;

  --line: #dbe3ee;
  --line-strong: #cbd5e1;

  --paper: #ffffff;
  --soft: #f8fafc;
  --soft-2: #f1f5f9;

  --navy: #1e293b;
  --navy-2: #334155;

  --blue: #2563eb;
  --blue-soft: #eff6ff;

  --cyan-soft: #ecfeff;
  --green-soft: #ecfdf5;
  --amber-soft: #fffbeb;
  --red-soft: #fef2f2;
  --purple-soft: #faf5ff;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  font-family: Inter, Arial, sans-serif;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink);
  background: #ffffff;
}

.report {
  width: 100%;
}

.cover,
.section,
.footer {
  page-break-inside: avoid;
}

.cover {
  position: relative;
  overflow: hidden;
  margin-bottom: 18px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: linear-gradient(135deg, #ffffff 0%, #f8fbff 54%, #eef6ff 100%);
}

.cover-bar {
  height: 7px;
  background: linear-gradient(90deg, #0f172a 0%, #334155 45%, #2563eb 100%);
}

.cover-content {
  display: table;
  width: 100%;
  padding: 20px 22px 22px;
}

.cover-main,
.cover-side {
  display: table-cell;
  vertical-align: top;
}

.cover-side {
  width: 190px;
  padding-left: 18px;
}

.eyebrow,
.section-kicker,
.summary-label,
.metric-label,
.score-label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--muted-soft);
}

.eyebrow {
  margin-bottom: 8px;
}

h1 {
  margin: 0;
  max-width: 100%;
  font-size: 25px;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: var(--navy);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.case-ref {
  display: inline-block;
  margin-top: 12px;
  padding: 5px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, .82);
  color: var(--navy-2);
  font-size: 10.5px;
  font-weight: 700;
}

.cover-meta-line {
  margin-top: 10px;
  color: var(--muted);
  font-size: 10.5px;
}

.score-card {
  margin-bottom: 10px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: rgba(255, 255, 255, .88);
}

.score-label {
  margin-bottom: 6px;
}

.score-value {
  max-width: 100%;
}

.section {
  margin-top: 20px;
}

.section.compact {
  margin-top: 0;
}

.section-title-row {
  display: table;
  width: 100%;
  margin-bottom: 9px;
}

.section-title-row > div {
  display: table-cell;
  vertical-align: bottom;
}

.section-count {
  width: 120px;
  text-align: right;
  color: var(--muted-soft);
  font-size: 10px;
  font-weight: 700;
}

h2 {
  margin: 2px 0 0;
  font-size: 15px;
  line-height: 1.2;
  color: var(--navy);
  letter-spacing: -0.01em;
}

.surface,
.message-card,
.exchange-card,
.timeline-card {
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: var(--paper);
  overflow: hidden;
}

.surface {
  padding: 14px 15px;
}

.no-padding {
  padding: 0;
}

.summary-grid {
  margin-right: -10px;
  font-size: 0;
}

.summary-card {
  display: inline-block;
  vertical-align: top;
  width: calc(25% - 10px);
  min-height: 66px;
  margin: 0 10px 10px 0;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--soft);
  font-size: 11px;
  overflow: hidden;
}

.summary-label {
  margin-bottom: 7px;
}

.summary-value {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.metric-row {
  display: table;
  width: 100%;
  margin-top: 3px;
  border-spacing: 8px 0;
}

.metric-card {
  display: table-cell;
  width: 16.66%;
  padding: 12px 8px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, var(--soft) 100%);
  text-align: center;
}

.metric-number {
  font-size: 20px;
  line-height: 1;
  font-weight: 800;
  color: var(--navy);
}

.metric-label {
  margin-top: 6px;
}

.badge {
  display: inline-block;
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--soft-2);
  color: var(--navy);
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
  text-transform: capitalize;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.status-open,
.status-in_progress {
  background: var(--blue-soft);
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.status-resolved,
.status-closed,
.status-archived,
.outcome-true_positive_without_impact,
.outcome-true_positive_with_impact,
.outcome-legitimate {
  background: var(--green-soft);
  color: #047857;
  border-color: #bbf7d0;
}

.severity-critical,
.severity-high {
  background: var(--red-soft);
  color: #b91c1c;
  border-color: #fecaca;
}

.severity-medium {
  background: var(--amber-soft);
  color: #92400e;
  border-color: #fde68a;
}

.severity-low {
  background: var(--cyan-soft);
  color: #0e7490;
  border-color: #a5f3fc;
}

.outcome-false_positive,
.outcome-false_positive_technical,
.outcome-not_applicable,
.outcome-unknown {
  background: var(--purple-soft);
  color: #6b21a8;
  border-color: #e9d5ff;
}

.prose-block {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.prose-block p {
  margin: 0 0 8px;
}

.prose-block p:last-child {
  margin-bottom: 0;
}

.prose-block ul,
.prose-block ol {
  margin: 6px 0 8px;
  padding-left: 18px;
}

.prose-block li {
  margin: 2px 0;
}

.prose-block pre,
.prose-block code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.prose-block blockquote {
  margin: 8px 0;
  padding: 8px 10px;
  border-left: 3px solid var(--line-strong);
  background: var(--soft);
  border-radius: 8px;
}

.empty {
  color: var(--muted-soft);
  font-style: italic;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

thead th {
  padding: 9px 9px;
  border-bottom: 1px solid var(--line-strong);
  background: var(--soft);
  color: var(--muted-soft);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .08em;
  text-align: left;
  text-transform: uppercase;
}

tbody td {
  padding: 9px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  font-size: 10.5px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:nth-child(even) td {
  background: #fbfdff;
}

.w-16 {
  width: 16%;
}

.w-20 {
  width: 20%;
}

.w-22 {
  width: 22%;
}

.w-24 {
  width: 24%;
}

.center {
  text-align: center;
}

.strong {
  font-weight: 700;
}

.mono {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.break-anywhere {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.check {
  display: inline-block;
  min-width: 38px;
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 800;
}

.check.is-done {
  background: var(--green-soft);
  color: #047857;
  border: 1px solid #bbf7d0;
}

.check.is-open {
  background: var(--soft-2);
  color: var(--muted);
  border: 1px solid var(--line);
}

.timeline {
  border-left: 2px solid var(--line);
  margin-left: 8px;
  padding-left: 15px;
}

.timeline-entry {
  position: relative;
  margin-bottom: 10px;
  page-break-inside: avoid;
}

.timeline-dot {
  position: absolute;
  left: -22px;
  top: 15px;
  width: 10px;
  height: 10px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: var(--blue);
}

.timeline-card {
  padding: 11px 12px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
}

.timeline-meta,
.message-date,
.exchange-date,
.exchange-direction {
  color: var(--muted-soft);
  font-size: 9.5px;
  font-weight: 700;
}

.timeline-title {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 800;
  color: var(--navy);
}

.timeline-body {
  margin-top: 7px;
  color: var(--muted);
}

.stack {
  display: block;
}

.message-card,
.exchange-card {
  margin-bottom: 10px;
  padding: 12px 13px;
  page-break-inside: avoid;
}

.message-head,
.exchange-head {
  display: table;
  width: 100%;
  margin-bottom: 8px;
}

.message-head > div,
.exchange-head > div {
  display: table-cell;
  vertical-align: top;
}

.message-date,
.exchange-date {
  width: 140px;
  text-align: right;
}

.message-title,
.exchange-subject {
  font-size: 12px;
  font-weight: 800;
  color: var(--navy);
}

.message-body,
.exchange-body {
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.exchange-card {
  border-left: 5px solid var(--line-strong);
}

.exchange-inbound {
  border-left-color: #2563eb;
}

.exchange-outbound {
  border-left-color: #64748b;
}

.exchange-meta {
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--soft);
  color: var(--muted);
  font-size: 10px;
}

.exchange-meta div {
  margin-bottom: 3px;
}

.exchange-meta div:last-child {
  margin-bottom: 0;
}

.json-block {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 10px;
  color: var(--muted);
}

.footer {
  display: table;
  width: 100%;
  margin-top: 26px;
  padding-top: 11px;
  border-top: 1px solid var(--line);
  color: var(--muted-soft);
  font-size: 9.5px;
}

.footer > div {
  display: table-cell;
}

.footer > div:last-child {
  text-align: right;
}
```

---

## Troubleshooting

### Preview returns a template error

Check:

- the variable name exists
- optional relations are protected with `{% if ... %}`
- JSON rows are accessed with `.get(...)`
- loops use valid collection names
- strings are quoted correctly

Example safe pattern:

```jinja2
{{ case.customer.name if case.customer else '-' }}
```

### A field is empty in the report

Check:

- the selected case actually contains the data
- the section is not hidden by an `{% if ... %}` condition
- the correct field name is used
- the value is stored under `key`, `field`, `type`, `status` or `state` for IoCs and assets

### Case description is displayed as raw HTML

Use:

```jinja2
{{ case.description|safe }}
```

Do not use `|nl2br` for rich HTML descriptions.

### Line breaks are not displayed in custom text

Use `|nl2br` on plain text values.

Example:

```jinja2
{{ params.get('executive_summary', '')|nl2br }}
```

### Missing parameter causes an error

Use `params.get(...)`.

Recommended:

```jinja2
{{ params.get('impact', '-') }}
```

Avoid:

```jinja2
{{ params.impact }}
```

unless the parameter is always provided.

### PDF layout is broken

Check:

- `@page` margin values
- large tables without word wrapping
- long unbroken values such as hashes and URLs
- overly complex CSS

Use:

```css
word-break: break-word;
```

for columns that may contain long values.

### The generated PDF does not match the preview

Check:

- the active saved template is the one used for generation
- the latest HTML and CSS were saved before generation
- the preview case and generated case are the same
- external assets are not required for rendering

---

## Recommended patterns

### Start small

Begin with:

```jinja2
<h1>{{ case.title }}</h1>
<p>{{ case.status }}</p>
```

Then add sections one by one.

### Use one template per audience

Recommended templates:

```text
Internal investigation report
Customer incident report
Closure report
Escalation report
Executive summary
```

Avoid using one very large template for every audience.

### Keep customer-facing reports concise

For customer-facing reports, prefer:

- summary
- impact
- timeline
- confirmed IoCs
- remediation actions
- conclusion

Avoid exposing internal comments or raw Exchange content unless it is intended for the recipient.

### Keep internal reports complete

For internal reports, include:

- comments
- activity timeline
- workbook
- linked alerts
- Exchange history
- attachments list
- raw parameters when useful

### Use custom parameters for final wording

Use `params` for values that may change at generation time.

Examples:

```text
executive_summary
impact
root_cause
recommendation
report_title
analyst_note
```

Template example:

```jinja2
{{ params.get('executive_summary', '')|nl2br }}
```

### Use `safe` only for trusted HTML

Use `|safe` for:

- case description
- comment text
- timeline text
- Exchange body

Avoid `|safe` for values provided as custom parameters unless HTML rendering is expected and controlled.

### Use `.get(...)` for IoCs and assets

IoC and asset rows may vary depending on how they were created.

Recommended:

```jinja2
{{ row.get('key') or row.get('field') or row.get('type') or '-' }}
{{ row.get('value') or '-' }}
{{ row.get('status') or row.get('state') or '-' }}
```

### Validate with several cases

Preview a template with:

- a case with IoCs and assets
- a case without IoCs
- a case with linked alerts
- a case with no workbook
- a case with comments and Exchanges
- an archived case

This helps catch missing field assumptions before the template is used in production.
