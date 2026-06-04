import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Card from "../../components/ui/Card";
import TiptapEditor from "../../components/ui/TiptapEditor";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  CloseButton,
  DeleteButton,
  NewGenButton,
  SaveButton,
  CancelButton,
  LeftButton,
} from "../../components/ui/IconButton";
import {
  createAutomationRule,
  getAutomationRule,
  getAutomationRuleMetadata,
  updateAutomationRule,
  type AutomationAction,
  type AutomationConditionNode,
  type AutomationConditionOperator,
  type AutomationGroupOperator,
  type AutomationRule,
  type AutomationRuleMetadata,
  type AutomationScope,
} from "../../api/settingsAutomationRules";

const EMPTY_VALUE = "__empty__";

function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
      {required ? <span className="ml-1 text-red-500">*</span> : null}
    </div>
  );
}

function SettingInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

function SettingTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "resize-y",
        props.className || "",
      ].join(" ")}
    />
  );
}

function SettingSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

function defaultConditions(): AutomationConditionNode {
  return {
    operator: "AND",
    children: [
        {
        field: "event",
        operator: "EQUAL",
        value: "case.created",
        },
    ],
  };
}

function defaultConditionsForScope(scope: AutomationScope): AutomationConditionNode {
  return {
    operator: "AND",
    children: [
      {
        field: "event",
        operator: "EQUAL",
        value:
          scope === "alert"
            ? "alert.created"
            : scope === "hunt"
            ? "hunt.created"
            : "case.created",
      },
    ],
  };
}

function defaultAction(): AutomationAction {
  return {
    type: "add_comment",
    body: "<p>Automation rule executed.</p>",
  };
}

function isGroup(
  node: AutomationConditionNode
): node is { operator: AutomationGroupOperator; children: AutomationConditionNode[] } {
  return Array.isArray((node as any).children);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function replaceNode(
  root: AutomationConditionNode,
  path: number[],
  next: AutomationConditionNode
): AutomationConditionNode {
  if (path.length === 0) return next;

  const copied = clone(root);
  let current: any = copied;

  for (let i = 0; i < path.length - 1; i += 1) {
    current = current.children[path[i]];
  }

  current.children[path[path.length - 1]] = next;
  return copied;
}

function addNode(
  root: AutomationConditionNode,
  path: number[],
  next: AutomationConditionNode
): AutomationConditionNode {
  const copied = clone(root);
  let current: any = copied;

  for (const index of path) {
    current = current.children[index];
  }

  current.children.push(next);
  return copied;
}

function removeNode(
  root: AutomationConditionNode,
  path: number[]
): AutomationConditionNode {
  if (path.length === 0) return root;

  const copied = clone(root);
  let current: any = copied;

  for (let i = 0; i < path.length - 1; i += 1) {
    current = current.children[path[i]];
  }

  current.children.splice(path[path.length - 1], 1);
  return copied;
}


function conditionFieldsForScope(
  meta: AutomationRuleMetadata | null,
  scope: AutomationScope
) {
  const fields = meta?.condition_fields ?? [];

  const allowedByScope: Record<AutomationScope, Set<string>> = {
    alert: new Set([
      "event",
      "title",
      "status",
      "owner",
      "classification",
      "severity",
      "customer",
      "source",
      "ioc_count",
      "asset_count",
      "ioc",
      "asset",
      "scheduled_time",
    ]),
    case: new Set([
      "event",
      "title",
      "status",
      "owner",
      "classification",
      "severity",
      "customer",
      "source",
      "linked_alert_count",
      "object_age_hours",
      "ioc_count",
      "asset_count",
      "inbound_exchange_delay_minutes",
      "ioc",
      "asset",
      "ioc_status",
      "asset_status",
      "scheduled_time",
    ]),
    hunt: new Set([
      "event",
      "title",
      "status",
      "owner",
      "classification",
      "customer",
      "object_age_hours",
      "ioc_count",
      "asset_count",
      "ioc",
      "asset",
      "scheduled_time",
    ]),
  };

  const allowed = allowedByScope[scope] ?? allowedByScope.case;

  return fields.filter((field) => allowed.has(field.value));
}

function eventValuesForScope(
  meta: AutomationRuleMetadata | null,
  scope: AutomationScope
) {
  return (meta?.event_values ?? []).filter((item) => {
    if (!item.scopes || item.scopes.length === 0) return true;
    return item.scopes.includes(scope);
  });
}

function statusOptionsForScope(
  meta: AutomationRuleMetadata | null,
  scope: AutomationScope
) {
  return meta?.statuses?.[scope] ?? [];
}

function actionValueOptions(
  meta: AutomationRuleMetadata | null,
  type: string,
  scope: AutomationScope
) {
  if (!meta) return [];

  if (type === "change_status") {
    return statusOptionsForScope(meta, scope);
  }

  if (type === "change_severity") {
    return meta.severities.map((x) => ({
      value: x.code,
      label: x.label,
    }));
  }

  if (type === "change_classification") {
    return meta.classifications.map((x) => ({
      value: x.code,
      label: x.label,
    }));
  }

  if (type === "change_customer") {
    return [
      { value: EMPTY_VALUE, label: "Empty" },
      ...meta.customers.map((x) => ({
        value: x.id,
        label: x.name,
      })),
    ];
  }

  if (type === "change_owner") {
    return [
      { value: EMPTY_VALUE, label: "Empty" },
      ...meta.users.map((x) => ({
        value: String(x.id),
        label: x.username,
      })),
    ];
  }

  return [];
}


function valueOptionsForField(
  meta: AutomationRuleMetadata | null,
  field: string,
  scope: AutomationScope
) {
  if (!meta) return [];

  if (field === "event") return eventValuesForScope(meta, scope);

  if (field === "status") {
    return statusOptionsForScope(meta, scope);
  }

  if (field === "severity") {
    return meta.severities.map((x) => ({
      value: x.code,
      label: x.label,
    }));
  }

  if (field === "classification") {
    return meta.classifications.map((x) => ({
      value: x.code,
      label: x.label,
    }));
  }

  if (field === "customer") {
    return [
      { value: EMPTY_VALUE, label: "Empty" },
      ...meta.customers.map((x) => ({
        value: x.id,
        label: x.name,
      })),
    ];
  }

  if (field === "owner") {
    return [
      { value: EMPTY_VALUE, label: "Empty" },
      ...meta.users.map((x) => ({
        value: String(x.id),
        label: x.username,
      })),
    ];
  }

  return [];
}


function isBetweenValue(value: unknown): value is { from?: string; to?: string } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeBetweenValue(value: unknown) {
  if (isBetweenValue(value)) {
    return {
      from: String(value.from ?? ""),
      to: String(value.to ?? ""),
    };
  }

  return {
    from: "",
    to: "",
  };
}

function recipientListToText(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}

function recipientTextToList(value: string) {
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}


function ConditionConnector({ operator }: { operator: AutomationGroupOperator }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-px flex-1 bg-border" />
      <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-xl">
        {operator}
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function NewConditionButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 cursor-pointer items-center rounded-2xl border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      + Condition
    </button>
  );
}

function NewGroupButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 cursor-pointer items-center rounded-2xl border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      + Group
    </button>
  );
}

function ConditionEditor({
  node,
  path,
  root,
  onChange,
  meta,
  disabled,
  scope,
}: {
  node: AutomationConditionNode;
  path: number[];
  root: AutomationConditionNode;
  onChange: (next: AutomationConditionNode) => void;
  meta: AutomationRuleMetadata | null;
  disabled: boolean;
  scope: AutomationScope;
}) {
  if (isGroup(node)) {
    const isRoot = path.length === 0;

    return (
      <div
        className={[
          "rounded-xl border transition-all",
          isRoot
            ? "border-border bg-muted/20 p-5"
            : "border-border/60 bg-card p-4 shadow-sm",
        ].join(" ")}
      >
        <div className="mb-4 flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
              {isRoot ? "Conditions" : "Nested group"}
            </div>

            <SettingSelect
              value={node.operator}
              disabled={disabled}
              onChange={(e) => {
                onChange(
                  replaceNode(root, path, {
                    ...node,
                    operator: e.target.value as AutomationGroupOperator,
                  })
                );
              }}
              className="h-8 w-fit min-w-[160px] text-xs font-semibold"
            >
              <option value="AND">All items match (AND)</option>
              <option value="OR">Any item matches (OR)</option>
            </SettingSelect>
          </div>

          <div className="flex items-center gap-1.5">
            <NewConditionButton
              disabled={disabled}
              onClick={() =>
                onChange(
                  addNode(root, path, {
                    field: "event",
                    operator: "EQUAL",
                    value: "",
                  })
                )
              }
            />

            <NewGroupButton
              disabled={disabled}
              onClick={() =>
                onChange(
                  addNode(root, path, {
                    operator: "AND",
                    children: [
                      {
                        field: "event",
                        operator: "EQUAL",
                        value: "",
                      },
                    ],
                  })
                )
              }
            />

            {!isRoot && (
              <DeleteButton
                title="Remove group"
                iconOnly={true}
                disabled={disabled}
                onClick={() => onChange(removeNode(root, path))}
              />
            )}
          </div>
        </div>

        <div className={!isRoot ? "ml-2 border-l-2 border-border/40 pl-4" : ""}>
          {node.children.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
              No conditions configured yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {node.children.map((child, index) => (
                <div key={index} className="relative">
                  {index > 0 && (
                    <div className="py-1">
                      <ConditionConnector operator={node.operator} />
                    </div>
                  )}

                  <ConditionEditor
                    node={child}
                    path={[...path, index]}
                    root={root}
                    onChange={onChange}
                    meta={meta}
                    disabled={disabled}
                    scope={scope}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

    const options = valueOptionsForField(meta, node.field, scope);
    const conditionFields = conditionFieldsForScope(meta, scope);
    const hasOptions = options.length > 0;

  return (
    <div className="group relative rounded-xl border border-border bg-background p-1.5 transition-colors hover:border-border/80">
      <div className="flex flex-row items-center gap-2">
        <div className="flex-1 min-w-[140px]">
          <SettingSelect
            value={node.field}
            disabled={disabled}
            aria-label="Condition field"
            className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
            onChange={(e) => {
              onChange(
                replaceNode(root, path, {
                  ...node,
                  field: e.target.value,
                  value: "",
                })
              );
            }}
          >
            {conditionFields.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </SettingSelect>
        </div>

        <div className="w-[160px] shrink-0">
          <SettingSelect
            value={node.operator}
            disabled={disabled}
            aria-label="Condition operator"
            className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
            onChange={(e) => {
            const nextOperator = e.target.value as AutomationConditionOperator;

            onChange(
                replaceNode(root, path, {
                ...node,
                operator: nextOperator,
                value:
                    nextOperator === "BETWEEN"
                    ? normalizeBetweenValue(node.value)
                    : isBetweenValue(node.value)
                        ? ""
                        : node.value,
                })
            );
            }}
          >
            {(meta?.operators ?? [
                "EQUAL",
                "NOT EQUAL",
                "CONTAINS",
                "DOES NOT CONTAIN",
                "GREATER THAN",
                "LESS THAN",
                "BETWEEN",
            ]).map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </SettingSelect>
        </div>

        <div className="flex-[1.2] min-w-[180px]">
        {node.field === "scheduled_time" && node.operator === "BETWEEN" ? (
            <div className="grid grid-cols-2 gap-2">
            <SettingInput
                type="time"
                value={normalizeBetweenValue(node.value).from}
                disabled={disabled}
                aria-label="Scheduled time from"
                className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
                onChange={(e) => {
                const current = normalizeBetweenValue(node.value);
                onChange(
                    replaceNode(root, path, {
                    ...node,
                    value: {
                        ...current,
                        from: e.target.value,
                    },
                    })
                );
                }}
            />

            <SettingInput
                type="time"
                value={normalizeBetweenValue(node.value).to}
                disabled={disabled}
                aria-label="Scheduled time to"
                className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
                onChange={(e) => {
                const current = normalizeBetweenValue(node.value);
                onChange(
                    replaceNode(root, path, {
                    ...node,
                    value: {
                        ...current,
                        to: e.target.value,
                    },
                    })
                );
                }}
            />
            </div>
        ) : node.field === "scheduled_time" ? (
            <SettingInput
            type="time"
            value={String(node.value ?? "")}
            disabled={disabled}
            aria-label="Scheduled time"
            className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
            onChange={(e) => {
                onChange(
                replaceNode(root, path, {
                    ...node,
                    value: e.target.value,
                })
                );
            }}
            />
        ) : hasOptions ? (
            <SettingSelect
            value={String(node.value ?? "")}
            disabled={disabled}
            aria-label="Condition value"
            className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
            onChange={(e) => {
                onChange(
                replaceNode(root, path, {
                    ...node,
                    value: e.target.value,
                })
                );
            }}
            >
            <option value="">Select...</option>
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                {option.label}
                </option>
            ))}
            </SettingSelect>
        ) : (
            <SettingInput
            value={String(node.value ?? "")}
            disabled={disabled}
            aria-label="Condition value"
            placeholder="Enter value..."
            className="h-9 border-transparent bg-transparent hover:bg-muted/50 focus:bg-background"
            onChange={(e) => {
                onChange(
                replaceNode(root, path, {
                    ...node,
                    value: e.target.value,
                })
                );
            }}
            />
        )}
        </div>

        <div className="flex shrink-0 items-center px-1">
          <DeleteButton
            title="Remove condition"
            iconOnly={true}
            disabled={disabled || path.length === 0}
            onClick={() => onChange(removeNode(root, path))}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </div>
    </div>
  );
}

function ActionEditor({
  action,
  index,
  meta,
  disabled,
  onChange,
  onRemove,
  scope,
}: {
  action: AutomationAction;
  index: number;
  meta: AutomationRuleMetadata | null;
  disabled: boolean;
  onChange: (next: AutomationAction) => void;
  onRemove: () => void;
  scope: AutomationScope;
}) {
  const type = action.type || "add_comment";

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">
            Action #{index + 1}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Actions are executed in the configured order.
          </div>
        </div>

        <DeleteButton
          title="Remove action"
          iconOnly={true}
          disabled={disabled}
          onClick={onRemove}
        />
      </div>

      <div className="space-y-4">
        <label className="block space-y-2">
          <FieldLabel required>Type</FieldLabel>
          <SettingSelect
            value={type}
            disabled={disabled}
            onChange={(e) => onChange({ type: e.target.value })}
          >
          {[
            { value: "add_comment", label: "Add comment", scopes: ["case", "alert", "hunt"] },
            { value: "exchange_message", label: "Add Exchange message", scopes: ["case", "alert"] },
            { value: "exchange_reply_last_inbound", label: "Reply to last inbound Exchange", scopes: ["case", "alert"] },
            { value: "exchange_reply_all_inbound", label: "Reply to all inbound Exchanges", scopes: ["case", "alert"] },
            { value: "change_status", label: "Change status", scopes: ["case", "alert", "hunt"] },
            { value: "change_classification", label: "Change classification", scopes: ["case", "alert", "hunt"] },
            { value: "change_owner", label: "Change owner", scopes: ["case", "alert", "hunt"] },
            { value: "change_customer", label: "Change customer", scopes: ["case", "alert", "hunt"] },
            { value: "change_severity", label: "Change severity", scopes: ["case", "alert"] },
            { value: "apply_workbook_template", label: "Apply workbook to case", scopes: ["case"] },
            { value: "run_investigation_template", label: "Run investigation template", scopes: ["case", "alert", "hunt"] },
          ]
            .filter((opt) => opt.scopes.includes(scope))
            .map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))
          }
          </SettingSelect>
        </label>

        {type === "add_comment" ? (
          <label className="block space-y-2">
            <FieldLabel required>Comment body</FieldLabel>
            <SettingTextarea
              rows={5}
              value={action.body || ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...action, body: e.target.value })}
              placeholder="<p>Comment content...</p>"
            />
          </label>
        ) : null}

        {["exchange_message", "exchange_reply_last_inbound", "exchange_reply_all_inbound"].includes(type) ? (
          <div className="space-y-4">
            {type === "exchange_message" ? (
              <label className="block space-y-2">
                <FieldLabel>Subject</FieldLabel>
                <SettingInput
                  value={action.subject || ""}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...action, subject: e.target.value })}
                  placeholder="Subject"
                />
              </label>
            ) : null}

            <label className="block space-y-2">
              <FieldLabel>Quickpart</FieldLabel>
              <SettingSelect
                value={action.quickpart_id || ""}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, quickpart_id: e.target.value })}
              >
                <option value="">No quickpart</option>
                {(meta?.quickparts ?? []).map((qp) => (
                  <option key={qp.id} value={qp.id}>
                    {qp.name}
                  </option>
                ))}
              </SettingSelect>
            </label>

            <label className="block space-y-2">
              <FieldLabel>Send mode</FieldLabel>
              <SettingSelect
                value={action.send_mode || "save"}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, send_mode: e.target.value })}
              >
                <option value="save">Save only</option>
                <option value="send">Send</option>
              </SettingSelect>
            </label>

            {type === "exchange_message" && (action.send_mode || "save") === "send" ? (
            <label className="block space-y-2">
                <FieldLabel required>To</FieldLabel>
                <SettingInput
                value={recipientListToText(action.to)}
                disabled={disabled}
                onChange={(e) =>
                    onChange({
                    ...action,
                    to: recipientTextToList(e.target.value),
                    })
                }
                placeholder="soc@example.com, customer@example.com"
                />
            </label>
            ) : null}

            {!action.quickpart_id ? (
            <div className="block space-y-2">
                <FieldLabel>Body (HTML editor)</FieldLabel>
                <div className="rounded-2xl border border-border bg-background p-3">
                <TiptapEditor
                    value={action.body || ""}
                    onChange={(value) => onChange({ ...action, body: value })}
                    disabled={disabled}
                    placeholder="Write Exchange message..."
                    className="text-sm"
                />
                </div>
            </div>
            ) : null}
          </div>
        ) : null}

        {type.startsWith("change_") ? (
        <label className="block space-y-2">
            <FieldLabel required>New value</FieldLabel>
            <SettingSelect
            value={action.value || ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...action, value: e.target.value })}
            >
            <option value="">Select...</option>
            {actionValueOptions(meta, type, scope).map((option) => (
                <option key={option.value} value={option.value}>
                {option.label}
                </option>
            ))}
            </SettingSelect>
        </label>
        ) : null}

        {type === "apply_workbook_template" ? (
        <label className="block space-y-2">
            <FieldLabel required>Workbook</FieldLabel>
            <SettingSelect
            value={action.workbook_template_id || ""}
            disabled={disabled || scope !== "case"}
            onChange={(e) =>
                onChange({ ...action, workbook_template_id: e.target.value })
            }
            >
            <option value="">Select...</option>
            {(meta?.workbooks ?? []).map((workbook) => (
                <option key={workbook.id} value={workbook.id}>
                {workbook.name}
                </option>
            ))}
            </SettingSelect>
            {scope !== "case" ? (
            <div className="text-xs text-muted-foreground">
                Workbook actions are available for Case rules only.
            </div>
            ) : null}
        </label>
        ) : null}

        {type === "run_investigation_template" ? (
        <div className="space-y-4">
            <label className="block space-y-2">
            <FieldLabel required>Investigation template</FieldLabel>
            <SettingSelect
                value={action.template_id || ""}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, template_id: e.target.value })}
            >
                <option value="">Select...</option>
                {(meta?.investigation_templates ?? []).map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {tpl.chat_command ? ` · ${tpl.chat_command}` : ""}
                </option>
                ))}
            </SettingSelect>
            </label>

            <label className="block space-y-2">
            <FieldLabel>Target source</FieldLabel>
            <SettingSelect
                value={action.target_source || "all_assets"}
                disabled={disabled}
                onChange={(e) =>
                onChange({
                    ...action,
                    target_source: e.target.value,
                    target_value: "",
                    target_type: "",
                    variables: {},
                })
                }
            >
                <option value="all_assets">All assets</option>
                <option value="all_iocs">All IoCs</option>
                <option value="all_iocs_and_assets">All IoCs and assets</option>
                <option value="specific_asset">Specific asset value</option>
                <option value="specific_ioc">Specific IoC value</option>
                <option value="description">Object description</option>
                <option value="manual">Manual value</option>
                <option value="trigger_asset">New asset</option>
                <option value="trigger_ioc">New IoC</option>
                <option value="first_asset">First asset</option>
                <option value="first_ioc">First IoC</option>
            </SettingSelect>
            <div className="text-xs text-muted-foreground">
            New-based targets only work when the rule is fired by an IoC or asset added event.
            </div>
            </label>

            {["specific_asset", "specific_ioc"].includes(action.target_source || "") ? (
            <label className="block space-y-2">
                <FieldLabel required>Target value</FieldLabel>
                <SettingInput
                value={action.target_value || ""}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, target_value: e.target.value })}
                placeholder="Exact value to target"
                />
            </label>
            ) : null}

            {(action.target_source || "") === "manual" ? (
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-2">
                <FieldLabel>Target type</FieldLabel>
                <SettingInput
                    value={action.target_type || ""}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...action, target_type: e.target.value })}
                    placeholder="account, ip, host..."
                />
                </label>

                <label className="block space-y-2">
                <FieldLabel required>Target value</FieldLabel>
                <SettingInput
                    value={action.target_value || ""}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...action, target_value: e.target.value })}
                    placeholder="toto"
                />
                </label>
            </div>
            ) : null}

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={!!action.post_result_comment}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...action,
                    post_result_comment: e.target.checked,
                    post_result_comment_mode: e.target.checked
                      ? action.post_result_comment_mode || "raw"
                      : action.post_result_comment_mode,
                  })
                }
              />
              Post investigation result as case comment
            </label>

            {action.post_result_comment ? (
              <label className="block space-y-2">
                <FieldLabel>Comment content</FieldLabel>
                <SettingSelect
                  value={action.post_result_comment_mode || "raw"}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...action,
                      post_result_comment_mode: e.target.value,
                    })
                  }
                >
                  <option value="raw">Post extracted result</option>
                  <option value="chatbot">Post chatbot summary</option>
                </SettingSelect>
                <div className="text-xs text-muted-foreground">
                  Chatbot summary uses the configured default AI provider.
                </div>
              </label>
            ) : null}
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}

function validateActions(actions: AutomationAction[], scope: AutomationScope) {
  for (const action of actions) {
    const type = action.type || "add_comment";

    if (type.startsWith("change_") && !String(action.value || "").trim()) {
      return "Every change action must have a value.";
    }

    if (type === "apply_workbook_template") {
      if (scope !== "case") return "Workbook actions are available for Case rules only.";
      if (!String(action.workbook_template_id || "").trim()) return "Workbook action must have a workbook.";
    }

    if (type === "run_investigation_template") {
      if (!String(action.template_id || "").trim()) return "Investigation action must have a template.";

      const source = action.target_source || "all_assets";

      if (["specific_asset", "specific_ioc", "manual"].includes(source)) {
        if (!String(action.target_value || "").trim()) {
          return "Investigation target value is required.";
        }
      }
    }

    if (type === "add_comment" && !String(action.body || "").trim()) {
        return "Comment body is required.";
    }

    if (type === "exchange_message" && (action.send_mode || "save") === "send") {
      const to = Array.isArray(action.to) ? action.to : [];
      if (!to.length) return "Exchange send action must have at least one recipient.";
    }
  }

  return "";
}



export default function AutomationRuleEdit() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { push } = useToast();
  const me = useMe();

  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canManage = can("settings.automation_rules.manage");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [meta, setMeta] = useState<AutomationRuleMetadata | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AutomationScope>("case");
  const [isEnabled, setIsEnabled] = useState(true);
  const [conditions, setConditions] = useState<AutomationConditionNode>(defaultConditions());
  const [actions, setActions] = useState<AutomationAction[]>([defaultAction()]);
  const [runOncePerTarget, setRunOncePerTarget] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [stopOnFirstActionError, setStopOnFirstActionError] = useState(false);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      setLoading(true);

      try {
        const metadata = await getAutomationRuleMetadata();
        if (!mounted) return;

        setMeta(metadata);

        if (!isNew && id) {
          const rule = await getAutomationRule(id);
          if (!mounted) return;

          setName(rule.name || "");
          setScope(rule.scope || "case");
          setIsEnabled(rule.is_enabled !== false);
          setConditions(rule.conditions || defaultConditions());
          setActions(Array.isArray(rule.actions) && rule.actions.length ? rule.actions : [defaultAction()]);
          setRunOncePerTarget(rule.run_once_per_target !== false);
          setCooldownSeconds(rule.cooldown_seconds || 0);
          setStopOnFirstActionError(!!rule.stop_on_first_action_error);
        }
      } catch (e: any) {
        push({
          kind: "error",
          title: "Error",
          message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
        });
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id, isNew, push]);

  const canSave = useMemo(() => {
    return canManage && name.trim() && actions.length > 0;
  }, [canManage, name, actions.length]);

  async function onSave() {
    if (!canSave) return;

    const actionsError = validateActions(actions, scope);

    if (actionsError) {
      push({
        kind: "error",
        title: "Invalid automation rule",
        message: actionsError,
      });
      return;
    }

    setSaving(true);

    try {
      const payload: Partial<AutomationRule> = {
        name: name.trim(),
        scope,
        is_enabled: isEnabled,
        conditions,
        actions,
        run_once_per_target: runOncePerTarget,
        cooldown_seconds: normalizeCooldownSeconds(cooldownSeconds),
        stop_on_first_action_error: stopOnFirstActionError,
      };

      const saved = isNew
        ? await createAutomationRule(payload)
        : await updateAutomationRule(id!, payload);

      push({ kind: "success", title: "Automation rule saved" });

      if (isNew) {
        navigate(`/settings/case-management/automation-rules/${saved.id}`);
      }
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network"),
      });
    } finally {
      setSaving(false);
    }
  }

  function updateAction(index: number, next: AutomationAction) {
    setActions((items) => items.map((item, i) => (i === index ? next : item)));
  }

  function removeAction(index: number) {
    setActions((items) => items.filter((_, i) => i !== index));
  }

  function normalizeCooldownSeconds(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }


  if (!canManage) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Automation Rule
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {isNew ? "New Automation Rule" : "Edit Automation Rule"}
          </h1>
        </div>

        <div className="flex gap-2">
          <CancelButton
            title="Cancel"
            iconOnly={true}
            onClick={() => navigate("/settings/case-management")}
          />
          <SaveButton
            title="Save automation rule"
            iconOnly={true}
            disabled={!canSave || saving || loading}
            onClick={onSave}
          />
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-5 md:grid-cols-3">
          <label className="block space-y-2 md:col-span-2">
            <FieldLabel required>Name</FieldLabel>
            <SettingInput
              value={name}
              disabled={loading || saving}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rule name"
            />
          </label>

          <label className="block space-y-2">
            <FieldLabel required>Scope</FieldLabel>
            <SettingSelect
              value={scope}
              disabled={loading || saving || !isNew}
              onChange={(e) => {
                const nextScope = e.target.value as AutomationScope;
                setScope(nextScope);
                setConditions(defaultConditionsForScope(nextScope));
              }}
            >
              {(meta?.scopes ?? [
                { value: "case", label: "Case" },
                { value: "alert", label: "Alert" },
                { value: "hunt", label: "Hunt" },
              ]).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </SettingSelect>
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={isEnabled}
              disabled={loading || saving}
              onChange={(e) => setIsEnabled(e.target.checked)}
            />
            Enabled
          </label>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={runOncePerTarget}
              disabled={loading || saving}
              onChange={(e) => setRunOncePerTarget(e.target.checked)}
            />
            Run once per object
          </label>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={stopOnFirstActionError}
              disabled={loading || saving}
              onChange={(e) => setStopOnFirstActionError(e.target.checked)}
            />
            Stop on first action error
          </label>
        </div>

        <label className="mt-5 block space-y-2">
          <FieldLabel>Delay between runs against same object, seconds</FieldLabel>
          <SettingInput
            type="number"
            min={0}
            value={cooldownSeconds}
            disabled={loading || saving}
            onChange={(e) => setCooldownSeconds(Number(e.target.value || 0))}
          />
        </label>
      </Card>

      <Card className="p-5">
        <div className="mb-5">
          <div className="text-sm font-semibold text-foreground">
            Conditions
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Choose a trigger and optional object conditions for this automation rule.
          </div>
        </div>

        <ConditionEditor
          node={conditions}
          path={[]}
          root={conditions}
          onChange={setConditions}
          meta={meta}
          disabled={loading || saving}
          scope={scope}
        />
      </Card>

      <Card className="p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Actions
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Configure one or more actions. Doko executes them without breaking if several are configured.
            </div>
          </div>

          <NewGenButton
            title="Add action"
            iconOnly={true}
            disabled={loading || saving}
            onClick={() => setActions((items) => [...items, defaultAction()])}
          />
        </div>

        <div className="space-y-4">
          {actions.map((action, index) => (
            <ActionEditor
              key={index}
              action={action}
              index={index}
              meta={meta}
              disabled={loading || saving}
              onChange={(next) => updateAction(index, next)}
              onRemove={() => removeAction(index)}
              scope={scope}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}