## Table of contents

- [Automation Rules](#automation-rules)
- [Rule settings](#rule-settings)
- [Conditions](#conditions)
- [Condition fields](#condition-fields)
- [Operators](#operators)
- [Actions](#actions)
- [Runtime values](#runtime-values)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Recommended patterns](#recommended-patterns)


## Automation Rules

Automation rules execute actions automatically when a Doko object matches a configured trigger and conditions.

A rule is made of:

- a scope
- one or more conditions
- one or more actions
- execution controls

A rule can target:

```text
Alert
Case
Hunt
```

Rules are useful for repetitive tasks such as:

- adding a comment when a new alert is created
- changing the status of a case when a condition is met
- assigning an owner automatically
- applying a workbook to a case
- creating an Exchange message
- replying to inbound Exchanges
- launching an investigation template on IoCs or assets
- posting investigation results as comments

---

## Rule settings

### Name

Display name of the automation rule.

Example:

```text
Run IP enrichment when a new IoC is added
```

Use a short name that describes the trigger and the expected action.

### Scope

Defines the type of object the rule applies to.

Available values:

```text
Alert
Case
Hunt
```

The scope controls which triggers, fields, and actions are available.

Examples:
 
- Alert : run actions when an alert is created or updated.
- Case : run actions when a case is created, updated, receives an IoC, receives an asset, or receives an Exchange.
- Hunt : run actions when a hunt is created or updated.

The scope is selected when the rule is created. Create a separate rule when the same behavior is needed for another object type.

### Enabled

Defines whether the rule can run.

Use this to temporarily disable a rule without deleting it.

### Run once per object

When enabled, the rule runs only once for the same object after a successful or partially successful execution.

Example:

```text
Run once per object: enabled
```

Use this when the rule should not repeat for the same alert, case, or hunt.

Disable it when the rule should be allowed to run several times on the same object, for example when new IoCs are added over time.

### Stop on first action error

Defines what happens when a rule has several actions and one action fails.

- Enabled ; The rule stops when one action fails.
- Disabled : The rule continues with the next actions.

Use this when later actions depend on earlier actions.

### Delay between runs against same object, seconds

Minimum delay before the same rule can run again against the same object.

Example:

```text
3600
```

This means the same rule cannot run again on the same object for one hour.

Use this to avoid repeated actions caused by frequent updates.

Recommended values:

- `0` : No delay.
- `300` : 5 minutes.
- `3600` : 1 hour.
- `86400` : 1 day.

---

## Conditions

Conditions define when a rule should run.

A condition contains:

- a field
- an operator
- a value

Example:

```text
Trigger EQUAL case.created
```

This means the rule runs when a case is created.

### Condition groups

Conditions can be grouped with:

```text
AND
OR
```

Use `AND` when all conditions must match.

Example:

```text
Trigger EQUAL case.created
AND
Severity EQUAL critical
```

Use `OR` when at least one condition must match.

Example:

```text
Severity EQUAL high
OR
Severity EQUAL critical
```

### Trigger condition

Most rules should start with a trigger condition.

The trigger field is:

```text
event
```

The value should be one of the available trigger values for the selected scope.

---

## Condition fields

### Trigger

Field name:

```text
event
```

Defines the event that starts the rule.

Available values:

- `alert.created` : An alert has been created. 
- `alert.updated` : An alert has been updated. 
- `case.created` :  A case has been created. 
- `case.updated` : A case has been updated. 
- `case.created_from_alert_escalation` : A case has been created from an alert escalation. 
- `case.ioc_added` : A new IoC has been added to a case. 
- `case.asset_added` : A new asset has been added to a case. 
- `case.exchange_inbound_received` : A new inbound Exchange has been received on a case. 
- `case.exchange_outbound_created` : A new outbound Exchange has been created on a case. 
- `hunt.created` : A hunt has been created. 
- `hunt.updated` : A hunt has been updated. 
- `scheduled_time` : The rule is evaluated by the scheduled automation runner. 

### Title

Field name:

```text
title
```

Matches the object title.

Example:

```text
Title CONTAINS phishing
```

### Status

Field name:

```text
status
```

Matches the object status.

Alert status values:

```text
open
merged
closed
```

Case status values:

```text
open
in_progress
resolved
closed
archived
```

Hunt status values:

```text
to_do
in_progress
completed
abandoned
```

### Owner

Field name:

```text
owner
```

Matches the object owner.

Use the selected user from the list.

The empty value can be used to match objects without an owner.

### Classification

Field name:

```text
classification
```

Matches the object classification.

Use one of the active classifications configured in Doko.

### Severity

Field name:

```text
severity
```

Matches the object severity.

Use one of the active severities configured in Doko.

This field is available for alerts and cases. It is not used for hunts.

### Customer

Field name:

```text
customer
```

Matches the customer attached to the object.

The empty value can be used to match objects without a customer.

### Source

Field name:

```text
source
```

Matches the source value on objects that expose a source.

Example:

```text
Source CONTAINS SIEM
```

### Linked alerts count

Field name:

```text
linked_alert_count
```

Counts alerts linked to a case.

Available for case rules.

Example:

```text
Linked alerts count GREATER THAN 2
```

### Object age, hours

Field name:

```text
object_age_hours
```

Number of hours since the object was created.

Example:

```text
Object age, hours GREATER THAN 24
```

### IoC count

Field name:

```text
ioc_count
```

Number of IoCs on the object.

Example:

```text
IoC count GREATER THAN 0
```

### Asset count

Field name:

```text
asset_count
```

Number of assets on the object.

Example:

```text
Asset count GREATER THAN 0
```

### Inbound Exchange delay, minutes

Field name:

```text
inbound_exchange_delay_minutes
```

Number of minutes since the latest inbound Exchange on a case.

Available for case rules.

Example:

```text
Inbound Exchange delay, minutes GREATER THAN 60
```

Use this to create follow-up behavior after an inbound message has been received.

### IoC

Field name:

```text
ioc
```

Matches IoC values on the object.

Example:

```text
IoC CONTAINS 8.8.8.8
```

When the rule is triggered by `case.ioc_added`, this field can match the newly added IoC.

### Asset

Field name:

```text
asset
```

Matches asset values on the object.

Example:

```text
Asset CONTAINS workstation
```

When the rule is triggered by `case.asset_added`, this field can match the newly added asset.

### IoC status

Field name:

```text
ioc_status
```

Matches the status of an IoC.

Example:

```text
IoC status EQUAL confirmed
```

When the rule is triggered by `case.ioc_added`, this field can match the status of the newly added IoC.

### Asset status

Field name:

```text
asset_status
```

Matches the status of an asset.

Example:

```text
Asset status EQUAL observed
```

When the rule is triggered by `case.asset_added`, this field can match the status of the newly added asset.

### Scheduled time

Field name:

```text
scheduled_time
```

Matches the current scheduled execution time in `HH:MM` format.

Example:

```text
Scheduled time BETWEEN 08:00 and 18:00
```

Use this field only for rules that should be evaluated on a schedule.

---

## Operators

### EQUAL

Matches when the field value is exactly equal to the configured value.

Example:

```text
Severity EQUAL critical
```

### NOT EQUAL

Matches when the field value is different from the configured value.

Example:

```text
Status NOT EQUAL closed
```

### CONTAINS

Matches when the field contains the configured value.

Example:

```text
Title CONTAINS ransomware
```

For IoCs and assets, this operator checks values and common item properties such as value, name, type, kind, status, and state.

### DOES NOT CONTAIN

Matches when the field does not contain the configured value.

Example:

```text
Title DOES NOT CONTAIN test
```

### GREATER THAN

Compares numeric values.

Example:

```text
Object age, hours GREATER THAN 24
```

### LESS THAN

Compares numeric values.

Example:

```text
Linked alerts count LESS THAN 3
```

### BETWEEN

Matches a numeric range or a time range.

Numeric example:

```text
Object age, hours BETWEEN 24 and 72
```

Time example:

```text
Scheduled time BETWEEN 08:00 and 18:00
```

For time ranges, use `HH:MM` format.

---

## Actions

Actions are executed in the configured order.

A rule can contain several actions.

### Add comment

Adds a comment to the object.

Behavior by scope:

- Alert : Adds an alert comment. 
- Case : Adds a case comment and timeline entry.
- Hunt : Adds a hunt journal note. 

Field:

- Comment body : HTML content of the comment.

Example body:

```html
<p>Automation rule executed.</p>
```

The comment is created as a Doko automation comment.

### Add Exchange message

Creates a new outbound Exchange message on a case.

This action requires a case. It can be used directly on case rules, or on alert rules when the alert is already linked to a case.

Fields:

- Subject : Subject of the Exchange message. 
- Quickpart : Optional reusable message body. 
- Send mode : Save only or send immediately. 
- To : Required when send mode is `Send`. 
- Body : Message body used when no quickpart is selected. 

Send modes:

- Save only : Creates the Exchange message without sending it.
- Send : Creates and sends the Exchange message.

Use `Save only` when the message should be reviewed before sending.

Use `Send` only when the recipients and content are safe to send automatically.

### Reply to last inbound Exchange

Creates an outbound reply based on the latest inbound Exchange on the case.

Fields:

- Quickpart : Optional reusable response body. 
- Send mode : Save only or send immediately. 
- Body : Response body used when no quickpart is selected. 

If no inbound Exchange exists, the action is skipped.

### Reply to all inbound Exchanges

Creates outbound replies for inbound Exchanges on the case.

Fields:

- Quickpart : Optional reusable response body.
- Send mode : Save only or send immediately. 
- Body : Response body used when no quickpart is selected.

Use this carefully. It can create several outbound Exchange messages.

### Change status

Changes the object status.

Available values depend on the selected scope.

Examples:

```text
open
in_progress
resolved
closed
completed
abandoned
```

### Change classification

Changes the object classification.

Use one of the active classifications configured in Doko.

### Change owner

Changes the object owner.

Use one of the active users available in the list.

The empty value can be used to clear the owner.

### Change customer

Changes the object customer.

Use one of the active customers available in the list.

The empty value can be used to clear the customer.

### Change severity

Changes the severity.

Use one of the active severities configured in Doko.

This action is available for alerts and cases. It is not available for hunts.

### Apply workbook to case

Applies a workbook template to a case.

This action is available for case rules only.

Field:

- Workbook : Workbook template to apply. 

When the action runs, the selected workbook template becomes the workbook for the case.

### Run investigation template

Runs an investigation template against a selected target.

Field:

- Investigation template : Template to run.
- Target source : Where the target value comes from.
- Target value : Required for specific or manual targets.
- Target type : Optional type for manual targets.
- Post investigation result as case comment : Posts the result as a case comment when a case is available.

Available target sources:

- All assets : Runs the template with all assets from the object. 
- All IoCs : Runs the template with all IoCs from the object. 
- All IoCs and assets : Runs the template with all IoCs and assets from the object. 
- Specific asset value : Runs only for the asset matching the exact configured value.
- Specific IoC value : Runs only for the IoC matching the exact configured value. 
- Object description : Uses the object description as the investigation input. 
- Manual value : Uses the configured manual value. 
- New asset : Uses the asset that triggered the rule. 
- New IoC : Uses the IoC that triggered the rule.
- First asset : Uses the first asset on the object.
- First IoC : Uses the first IoC on the object.

`New asset` only works when the rule is triggered by an asset-added event.

`New IoC` only works when the rule is triggered by an IoC-added event.

When `Post investigation result as case comment` is enabled, the result is added as a case comment if the automation has a case context.

---

## Runtime values

Automation actions can use runtime values when they render comments, Exchange messages, and investigation requests.

Common values:

- `{{scope}}` : Current rule scope: alert, case, or hunt.
- `{{event}}` : Trigger event that started the rule.
- `{{target.id}}` : Identifier of the object matched by the rule.
- `{{target.title}}` : Title of the matched object.
- `{{target.description}}` : Description of the matched object. 
- `{{target.status}}` : Status of the matched object. 
- `{{target.severity}}` : Severity of the matched object when available. 
- `{{target.classification}}` : Classification of the matched object. 
- `{{target.customer_id}}` : Customer identifier of the matched object. 
- `{{target.owner_id}}` : Owner identifier of the matched object. 
- `{{case.id}}` : Case identifier when the matched object is a case. 
- `{{case.title}}` : Case title when the matched object is a case. 
- `{{case.description}}` : Case description when the matched object is a case. 
- `{{alert.id}}` : Alert identifier when the matched object is an alert. 
- `{{alert.title}}` : Alert title when the matched object is an alert. 
- `{{alert.description}}` : Alert description when the matched object is an alert. 
- `{{hunt.id}}` : Hunt identifier when the matched object is a hunt. 
- `{{hunt.title}}` : Hunt title when the matched object is a hunt. 
- `{{hunt.description}}` : Hunt context or description value when available. 
- `{{ioc.value}}` : Value of the IoC that triggered the rule. 
- `{{ioc.type}}` : Type of the IoC that triggered the rule. 
- `{{ioc.status}}` : Status of the IoC that triggered the rule. 
- `{{asset.value}}` : Value of the asset that triggered the rule. 
- `{{asset.type}}` : Type of the asset that triggered the rule. 
- `{{asset.status}}` : Status of the asset that triggered the rule. 
- `{{container_id}}` : Container identifier when available. 
- `{{incident_id}}` : Incident identifier when available. 
- `{{exchange.id}}` : Exchange identifier when the rule is triggered by an Exchange. 
- `{{exchange.subject}}` : Exchange subject when available. 
- `{{exchange.sender}}` : Exchange sender when available. 

Example comment body:

```html
<p>New IoC added: <strong>{{ioc.value}}</strong></p>
<p>Case: {{case.title}}</p>
```

Example Exchange body:

```html
<p>Hello,</p>
<p>A new inbound message was received for case {{case.title}}.</p>
<p>This response was prepared automatically.</p>
```

---

## Examples

### Example: add a comment when a critical alert is created

#### Rule settings

- Name : `Comment on critical alerts` 
- Scope : `Alert` 
- Enabled : enabled 
- Run once per object : enabled 
- Stop on first action error : disabled 
- Delay between runs : `0` 

#### Conditions

```text
Trigger EQUAL alert.created
AND
Severity EQUAL critical
```

#### Action

- Type : `Add comment`
- Comment body : `<p>Critical alert created. Review priority should be high.</p>`

---

### Example: assign new high severity cases to an analyst

#### Rule settings

- Name : `Assign high severity cases` 
- Scope : `Case` 
- Enabled : enabled 
- Run once per object : enabled 
- Stop on first action error : enabled 
- Delay between runs : `0` 

#### Conditions

```text
Trigger EQUAL case.created
AND
Severity EQUAL high
```

#### Action

- Type : `Change owner`
- New value : selected analyst

---

### Example: apply a workbook to new cases

#### Rule settings

- Name : `Apply default workbook to new cases` 
- Scope : `Case` 
- Enabled : enabled 
- Run once per object : enabled 
- Stop on first action error : enabled 
- Delay between runs : `0` 

#### Conditions

```text
Trigger EQUAL case.created
```

#### Action

- Type : `Apply workbook to case`
- Workbook : selected workbook template

---

### Example: run an investigation when a new IoC is added

#### Rule settings

- Name : `Run enrichment on new IoCs`
- Scope : `Case`
- Enabled : enabled
- Run once per object : disabled
- Stop on first action error : disabled
- Delay between runs : `60`

#### Conditions

```text
Trigger EQUAL case.ioc_added
AND
IoC status NOT EQUAL false_positive
```

#### Action

- Type : `Run investigation template`
- Investigation template : selected enrichment template
- Target source : `New IoC`
- Post investigation result as case comment : enabled

Use this pattern when each new IoC should be enriched automatically.

---

### Example: run one investigation for all assets on new cases

#### Rule settings

- Name : `Run asset inventory lookup on new cases`
- Scope : `Case`
- Enabled : enabled
- Run once per object : enabled
- Stop on first action error : disabled
- Delay between runs : `0`

#### Conditions

```text
Trigger EQUAL case.created
AND
Asset count GREATER THAN 0
```

#### Action

- Type : `Run investigation template`
- Investigation template : selected asset lookup template
- Target source : `All assets`
- Post investigation result as case comment : enabled

---

### Example: prepare an Exchange reply after an inbound message

#### Rule settings

- Name : `Prepare reply after inbound Exchange`
- Scope : `Case`
- Enabled : enabled
- Run once per object : disabled
- Stop on first action error : enabled
- Delay between runs : `300`

#### Conditions

```text
Trigger EQUAL case.exchange_inbound_received
```

#### Action

- Type : `Reply to last inbound Exchange`
- Quickpart : selected quickpart
- Send mode : `Save only`

Use `Save only` when the reply should be reviewed before it is sent.

---

### Example: send an automatic Exchange message for a resolved case

#### Rule settings

- Name : `Send resolved case notification`
- Scope : `Case`
- Enabled : enabled
- Run once per object : enabled
- Stop on first action error : enabled
- Delay between runs : `0`

#### Conditions

```text
Trigger EQUAL case.updated
AND
Status EQUAL resolved
```

#### Action

- Type : `Add Exchange message`
- Subject : `Case resolved`
- Send mode : `Send`
- To : `customer@example.com`
- Body : `<p>The case {{case.title}} has been resolved.</p>`

Use this only when the recipient list is reliable and the message can be sent without manual review.

---

### Example: add a hunt journal note when a hunt is completed

#### Rule settings

- Name : `Add completion note to hunts`
- Scope : `Hunt`
- Enabled : enabled
- Run once per object : enabled
- Stop on first action error : disabled
- Delay between runs : `0`

#### Conditions

```text
Trigger EQUAL hunt.updated
AND
Status EQUAL completed
```

#### Action

- Type : `Add comment`
- Comment body : `<p>Hunt completed. Review findings and linked cases.</p>`

For hunt rules, the comment action creates a hunt journal note.

---

### Example: scheduled rule for old open cases

#### Rule settings

- Name : `Flag old open cases`
- Scope : `Case`
- Enabled : enabled
- Run once per object : disabled
- Stop on first action error : disabled
- Delay between runs : `86400`

#### Conditions

```text
Trigger EQUAL scheduled_time
AND
Scheduled time BETWEEN 08:00 and 18:00
AND
Status EQUAL open
AND
Object age, hours GREATER THAN 72
```

#### Action

- Type : `Add comment`
- Comment body : `<p>This case has been open for more than 72 hours.</p>`

Use a delay between runs to avoid adding the same comment too often.

---

## Troubleshooting

### The rule does not run

Check:

- The rule is enabled.
- The selected scope matches the object type.
- The trigger value matches the event that actually occurred.
- The conditions are not too restrictive.
- The user configuring the rule has permission to manage automation rules.
- `Run once per object` has not already prevented another execution.
- The delay between runs has not blocked the new execution.

### The rule runs only once

Check whether `Run once per object` is enabled.

If the same rule must run again on the same object, disable this option or create a separate rule for the repeated behavior.

### The rule runs too often

Increase the delay between runs against the same object.

Example:

```text
3600
```

This limits the rule to one run per hour for the same object.

### The investigation template does not run

Check:

- The selected investigation template is enabled.
- The selected SOAR provider is enabled.
- The target source actually returns a value.
- `New IoC` is used only with an IoC-added trigger.
- `New asset` is used only with an asset-added trigger.
- Specific targets use the exact value of the IoC or asset.

### No investigation result is posted as a comment

Check:

- `Post investigation result as case comment` is enabled.
- The rule has a case context.
- The investigation template returns a result.
- The remote platform does not time out.

For alert rules, a case comment can be posted only when the alert is linked to a case.

For hunt rules, use the comment action when the expected result should be stored in the hunt journal.

### The Exchange action does not send

Check:

- Send mode is set to `Send`.
- At least one recipient is configured for a new Exchange message.
- The selected quickpart or body is valid.
- The case has the required Exchange configuration.

### The wrong objects are updated

Check:

- The scope.
- The trigger.
- The customer condition.
- The owner condition.
- The status condition.

Use restrictive conditions before actions that change status, owner, customer, classification, or severity.

---

## Recommended patterns

### Start with a comment action

When creating a new rule, first test it with an `Add comment` action.

Example:

```html
<p>Test automation rule matched {{target.title}}.</p>
```

After confirming that the rule matches the expected objects, replace or extend the action.

### Use one rule for one clear behavior

Prefer separate rules for separate actions.

Good pattern:

```text
Rule 1: Apply workbook to new cases
Rule 2: Enrich new IoCs
Rule 3: Prepare reply after inbound Exchange
```

Avoid one large rule that tries to handle unrelated scenarios.

### Use Run once per object for creation triggers

For triggers such as:

```text
alert.created
case.created
hunt.created
```

`Run once per object` is usually recommended.

### Disable Run once per object for added item triggers

For triggers such as:

```text
case.ioc_added
case.asset_added
```

Disable `Run once per object` when each new IoC or asset should be processed.

Use a delay between runs if needed.

### Use Save only before Send

For Exchange actions, start with:

```text
Save only
```

After the generated messages have been reviewed and validated, switch to:

```text
Send
```

### Use New IoC and New asset for precise enrichment

When a rule is triggered by a newly added item, prefer:

```text
Target source: New IoC
```

or:

```text
Target source: New asset
```

This avoids reprocessing every IoC or asset on the object.

### Keep scheduled rules narrow

Scheduled rules can evaluate many objects.

Use conditions such as:

```text
Status EQUAL open
Object age, hours GREATER THAN 72
Customer EQUAL selected customer
```

Use a delay between runs to avoid repeated comments or repeated remote actions.

### Keep remote automation results structured

Investigation templates should return compact structured results when possible.

Recommended shape:

```json
{
  "status": "success",
  "message": "Analysis completed",
  "outputs": {
    "summary": "No malicious signal found.",
    "risk": "low",
    "items": []
  }
}
```

Structured results are easier to post, review, and summarize.
