import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Card from "../../components/ui/Card";
import { useToast } from "../../components/ui/toast";
import { useMe } from "../../contexts/MeContext";
import {
  listAIProviders,
  listInvestigationTemplates,
  listSOARProviders,
  createAIProvider,
  createSOARProvider,
  createInvestigationTemplate,
  updateAIProvider,
  updateSOARProvider,
  updateInvestigationTemplate,
  deleteInvestigationTemplate,
  deleteSOARProvider,
  AIProvider,
  SOARProvider,
  InvestigationTemplate,
  buildSimpleSOARPayload,
  buildSimpleInvestigationTemplatePayload,
} from "../../api/settingsChat";
import {
  NewGenButton,
  SaveButton,
  CancelButton,
  DeleteButton,
  EditGenButton,
} from "../../components/ui/IconButton";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatApiError(error: any, fallback: string) {
  const data = error?.response?.data;

  if (!data) {
    return error?.message || fallback;
  }

  if (typeof data === "string") {
    return data;
  }

  if (typeof data.detail === "string") {
    return data.detail;
  }

  if (typeof data === "object") {
    return Object.entries(data)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: ${value.join(", ")}`;
        }

        if (typeof value === "string") {
          return `${key}: ${value}`;
        }

        return `${key}: ${JSON.stringify(value)}`;
      })
      .join(" · ");
  }

  return fallback;
}


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
      {required ? <span className="ml-1 text-destructive">*</span> : null}
    </div>
  );
}

function SectionHint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-sm text-muted-foreground">{children}</div>;
}

const emptyLlmForm = {
  name: "",
  code: "",
  provider_kind: "litellm",
  base_url: "",
  default_model: "",
  default_system_prompt: "",
  timeout_seconds: 60,
  is_enabled: true,
  is_default: false,
  api_key: "",
};

const emptySoarForm = {
  name: "",
  code: "",
  provider_kind: "generic_http",
  base_url: "",
  auth_type: "bearer",
  auth_token_type: "",
  auth_username: "",
  auth_config_text: "{}",
  request_config_text: `{
  "method": "POST",
  "url_template": "{base_url}/api/chat/templates/{template.remote_template_code}/execute",
  "headers": {},
  "body_template": {
    "variables": "{variables}"
  }
}`,
  response_config_text: "{}",
  status_config_text: "{}",
  timeout_seconds: 60,
  is_enabled: true,
  api_key: "",
};

const emptyTemplateForm = {
  code: "",
  name: "",
  description: "",
  selection_hint: "",
  chat_command: "",
  command_help: "",
  ai_context: "",
  entity_type: "ip",
  target_kind: "single",
  soar_provider: "",
  remote_template_code: "",
  default_variables_text: "{}",
  allowed_variables_schema_text: "{}",
  prompt_overrides_schema_text: "{}",
  input_mapping_text: "{}",
  output_mapping_text: "{}",
  status_mapping_text: "{}",
  execution_config_text: "{}",
  max_time_range_hours: 24,
  risk_level: "medium",
  is_enabled: true,
  remote_template_field: "playbook_id",
  target_object_field: "container_id",
  default_target_object_id: "",
  input_payload_field: "inputs",
  input_variable_name: "doko_output",
};

function resetLlmForm() {
  return { ...emptyLlmForm };
}

function resetSoarForm() {
  return { ...emptySoarForm };
}

function soarToForm(item: SOARProvider) {
  const authConfig = item.auth_config || {};

  return {
    name: item.name || "",
    code: item.code || "",
    provider_kind: item.provider_kind || "generic_http",
    base_url: item.base_url || "",
    auth_type: item.auth_type || "bearer",
    auth_token_type:
      typeof authConfig.header_name === "string" ? authConfig.header_name : "",
    auth_username:
      typeof authConfig.username === "string" ? authConfig.username : "",
    auth_config_text: JSON.stringify(authConfig, null, 2),
    request_config_text: JSON.stringify(item.request_config || {}, null, 2),
    response_config_text: JSON.stringify(item.response_config || {}, null, 2),
    status_config_text: JSON.stringify(item.status_config || {}, null, 2),
    timeout_seconds: item.timeout_seconds || 60,
    is_enabled: !!item.is_enabled,
    api_key: "",
  };
}

function resetTemplateForm() {
  return { ...emptyTemplateForm };
}

function templateLaunchFields(item: InvestigationTemplate) {
  const executionConfig = item.execution_config || {};
  const launchFields =
    typeof executionConfig.launch_fields === "object" &&
    executionConfig.launch_fields !== null &&
    !Array.isArray(executionConfig.launch_fields)
      ? (executionConfig.launch_fields as Record<string, unknown>)
      : {};

  return {
    remote_template_field:
      String(launchFields.remote_template_field || "").trim() || "playbook_id",
    target_object_field:
      String(launchFields.target_object_field || "").trim() || "container_id",
    input_payload_field:
      String(launchFields.input_payload_field || "").trim() || "inputs",
    input_variable_name:
      String(launchFields.input_variable_name || "").trim() || "doko_output",
  };
}

function templateDefaultTargetObjectId(item: InvestigationTemplate) {
  const defaults = item.default_variables || {};
  const launchFields = templateLaunchFields(item);

  const candidates = [
    defaults[launchFields.target_object_field],
    defaults.target_object_id,
    defaults.container_id,
    defaults.incident_id,
    defaults.case_id,
    defaults.object_id,
  ];

  const value = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      candidate !== null &&
      String(candidate).trim()
  );

  return value === undefined || value === null ? "" : String(value);
}


function templateToForm(item: InvestigationTemplate) {
  const launchFields = templateLaunchFields(item);

  return {
    code: item.code || "",
    name: item.name || "",
    description: item.description || "",
    selection_hint: item.selection_hint || "",
    chat_command: item.chat_command || "",
    command_help: item.command_help || "",
    ai_context: item.ai_context || "",
    entity_type: item.entity_type || "ip",
    target_kind: item.target_kind || "single",
    soar_provider: item.soar_provider || "",
    remote_template_code: item.remote_template_code || "",
    default_variables_text: JSON.stringify(item.default_variables || {}, null, 2),
    allowed_variables_schema_text: JSON.stringify(
      item.allowed_variables_schema || {},
      null,
      2
    ),
    prompt_overrides_schema_text: JSON.stringify(
      item.prompt_overrides_schema || {},
      null,
      2
    ),
    input_mapping_text: JSON.stringify(item.input_mapping || {}, null, 2),
    output_mapping_text: JSON.stringify(item.output_mapping || {}, null, 2),
    status_mapping_text: JSON.stringify(item.status_mapping || {}, null, 2),
    execution_config_text: JSON.stringify(item.execution_config || {}, null, 2),
    max_time_range_hours: item.max_time_range_hours || 24,
    risk_level: item.risk_level || "medium",
    is_enabled: !!item.is_enabled,
    remote_template_field: launchFields.remote_template_field,
    target_object_field: launchFields.target_object_field,
    default_target_object_id: templateDefaultTargetObjectId(item),
    input_payload_field: launchFields.input_payload_field,
    input_variable_name: launchFields.input_variable_name,
  };
}

function SettingInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }
) {
  return (
    <input
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function SettingSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string }
) {
  return (
    <select
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition",
        "focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function SettingTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }
) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function ConfigStatusBadge({
  enabled,
  label,
}: {
  enabled: boolean;
  label?: string;
}) {
  return (
    <div
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-border bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {label ?? (enabled ? "Enabled" : "Disabled")}
    </div>
  );
}

function SettingCheckbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-border"
      />
      <span>{label}</span>
    </label>
  );
}


function normalizeTimeoutSeconds(value: unknown, fallback = 60) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, 1), 120);
}



export default function AIAndSOARSettingsPage() {
  const toast = useToast();
  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);
  const canManage = can("chat.provider.manage");

  const [tab, setTab] = useState<"llm" | "soar" | "templates">("llm");
  const [llmProviders, setLlmProviders] = useState<AIProvider[]>([]);
  const [soarProviders, setSoarProviders] = useState<SOARProvider[]>([]);
  const [templates, setTemplates] = useState<InvestigationTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSoarForm, setShowSoarForm] = useState(false);
  const [editingSoarId, setEditingSoarId] = useState<string | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const [llmForm, setLlmForm] = useState(emptyLlmForm);
  const [soarForm, setSoarForm] = useState(emptySoarForm);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);

  const singleLlmProvider = llmProviders[0] || null;

  async function loadAll() {
    if (!canManage) {
      setLlmProviders([]);
      setSoarProviders([]);
      setTemplates([]);
      setLlmForm(resetLlmForm());
      setSoarForm(resetSoarForm());
      setTemplateForm(resetTemplateForm());
      setLoading(false);
      return;
    }
    setLoading(true);

    const [llmResult, soarResult, templateResult] = await Promise.allSettled([
      listAIProviders(),
      listSOARProviders(),
      listInvestigationTemplates(),
    ]);

    let hasError = false;

    if (llmResult.status === "fulfilled") {
      const llmData = llmResult.value || [];
      setLlmProviders(llmData);

      const llm = llmData[0];
      if (llm) {
        setLlmForm({
          name: llm.name || "",
          code: llm.code || "",
          provider_kind: llm.provider_kind || "litellm",
          base_url: llm.base_url || "",
          default_model: llm.default_model || "",
          default_system_prompt: llm.default_system_prompt || "",
          timeout_seconds: llm.timeout_seconds || 60,
          is_enabled: llm.is_enabled,
          is_default: llm.is_default,
          api_key: "",
        });
      } else {
        setLlmForm(resetLlmForm());
      }
    } else {
      hasError = true;
      setLlmProviders([]);
      setLlmForm(resetLlmForm());
    }

    if (soarResult.status === "fulfilled") {
      setSoarProviders(soarResult.value || []);
    } else {
      hasError = true;
      setSoarProviders([]);
      setSoarForm(resetSoarForm());
    }

    if (templateResult.status === "fulfilled") {
      setTemplates(templateResult.value || []);
    } else {
      hasError = true;
      setTemplates([]);
    }

    if (hasError) {
      toast.push({
        kind: "error",
        title: "AI & SOAR",
        message: "Part of the configuration could not be loaded",
      });
    }

    setLoading(false);
  }

  function closeSoarForm() {
    setShowSoarForm(false);
    setEditingSoarId(null);
    setSoarForm(resetSoarForm());
  }

  function openCreateSoarForm() {
    if (!canManage) return;
    setEditingSoarId(null);
    setSoarForm(resetSoarForm());
    setShowSoarForm(true);
  }

  function openEditSoarForm(item: SOARProvider) {
    if (!canManage) return;
    setEditingSoarId(item.id);
    setSoarForm(soarToForm(item));
    setShowSoarForm(true);
  }

  function closeTemplateForm() {
    setShowTemplateForm(false);
    setEditingTemplateId(null);
    setTemplateForm(resetTemplateForm());
  }

  function openCreateTemplateForm() {
    if (!canManage) return;
    setEditingTemplateId(null);
    setTemplateForm(resetTemplateForm());
    setShowTemplateForm(true);
  }

  function openEditTemplateForm(item: InvestigationTemplate) {
    if (!canManage) return;
    setEditingTemplateId(item.id);
    setTemplateForm(templateToForm(item));
    setShowTemplateForm(true);
  }

  useEffect(() => {
    setShowSoarForm(false);
    setEditingSoarId(null);
    setSoarForm(resetSoarForm());
    setShowTemplateForm(false);
    setEditingTemplateId(null);
    setTemplateForm(resetTemplateForm());
  }, [tab]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void loadAll();
  }, [canManage]);

  async function handleCreateLlm() {
    if (!canManage) return;
    setSaving(true);
    try {
      const payload = {
        name: llmForm.name.trim(),
        code: slugify(llmForm.name.trim()),
        provider_kind: llmForm.provider_kind.trim(),
        base_url: llmForm.base_url.trim(),
        default_model: llmForm.default_model.trim(),
        default_system_prompt: llmForm.default_system_prompt.trim(),
        timeout_seconds: normalizeTimeoutSeconds(llmForm.timeout_seconds, 60),
        is_enabled: llmForm.is_enabled,
        is_default: true,
        api_key: llmForm.api_key.trim() || undefined,
      };

      if (singleLlmProvider) {
        await updateAIProvider(singleLlmProvider.id, payload);
        toast.push({
          kind: "success",
          title: "AI & SOAR",
          message: "LLM provider updated",
        });
      } else {
        await createAIProvider(payload);
        toast.push({
          kind: "success",
          title: "AI & SOAR",
          message: "LLM provider created",
        });
      }

      await loadAll();
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "AI & SOAR",
        message:
          e?.response?.data?.detail || e?.message || "Unable to save LLM provider",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSoar() {
    if (!canManage) return;
    setSaving(true);
    try {
      const payload = buildSimpleSOARPayload({
        name: soarForm.name.trim(),
        base_url: soarForm.base_url.trim(),
        auth_type: soarForm.auth_type.trim() || "none",
        auth_token_type: soarForm.auth_token_type.trim(),
        auth_username: soarForm.auth_username.trim(),
        timeout_seconds: normalizeTimeoutSeconds(soarForm.timeout_seconds, 60),
        is_enabled: soarForm.is_enabled,
        api_key: soarForm.api_key.trim() || undefined,
      });

      if (editingSoarId) {
        await updateSOARProvider(editingSoarId, payload);
        toast.push({
          kind: "success",
          title: "AI & SOAR",
          message: "SOAR provider updated",
        });
      } else {
        await createSOARProvider(payload);
        toast.push({
          kind: "success",
          title: "AI & SOAR",
          message: "SOAR provider created",
        });
      }

      closeSoarForm();
      await loadAll();
      setTab("soar");
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "AI & SOAR",
        message: formatApiError(
          e,
          editingSoarId ? "Unable to update SOAR provider" : "Unable to create SOAR provider"
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSoar() {
    if (!canManage || !editingSoarId) return;

    const current = soarProviders.find((p) => p.id === editingSoarId);
    const confirmed = window.confirm(
      `Delete SOAR provider "${current?.name || "this provider"}"?`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteSOARProvider(editingSoarId);
      toast.push({
        kind: "success",
        title: "AI & SOAR",
        message: "SOAR provider deleted",
      });
      closeSoarForm();
      await loadAll();
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "AI & SOAR",
        message:
          e?.response?.data?.detail ||
          e?.message ||
          "Unable to delete SOAR provider",
      });
    } finally {
      setDeleting(false);
    }
  }

  function parseJsonObject(text: string, fallback: Record<string, unknown> = {}) {
    try {
      const value = JSON.parse(text || "{}");
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fallback;
    } catch {
      return fallback;
    }
  }


  function syncRemoteTemplateInputMapping(
    mapping: Record<string, unknown>,
    previousRemoteField: string,
    nextRemoteField: string
  ): Record<string, unknown> {
    const next = { ...mapping };

    const previousField = previousRemoteField.trim();
    const nextField = nextRemoteField.trim();

    if (!nextField) {
      return next;
    }

    const previousRule =
      previousField && Object.prototype.hasOwnProperty.call(next, previousField)
        ? next[previousField]
        : undefined;

    if (previousField && previousField !== nextField) {
      delete next[previousField];
    }

    if (!Object.prototype.hasOwnProperty.call(next, nextField)) {
      next[nextField] =
        previousRule && typeof previousRule === "object" && !Array.isArray(previousRule)
          ? previousRule
          : {
              fallback_template_field: "remote_template_code",
            };
    }

    return next;
  }


  function ensureDokoOutputInputMapping(
    mapping: Record<string, unknown>
  ): Record<string, unknown> {
    const next = { ...mapping };

    if (!Object.prototype.hasOwnProperty.call(next, "doko_output")) {
      next.doko_output = {
        from_variable: "doko_output",
      };
    }

    return next;
  }


  async function handleSaveTemplate() {
    if (!canManage) return;
    setSaving(true);
    try {
      const basePayload = buildSimpleInvestigationTemplatePayload({
        name: templateForm.name.trim(),
        description: templateForm.description.trim(),
        selection_hint: templateForm.selection_hint.trim(),
        chat_command: templateForm.chat_command.trim(),
        soar_provider: templateForm.soar_provider,
        remote_template_code: templateForm.remote_template_code.trim(),
        remote_template_field: templateForm.remote_template_field.trim(),
        target_object_field: templateForm.target_object_field.trim(),
        default_target_object_id: templateForm.default_target_object_id.trim(),
        input_payload_field: templateForm.input_payload_field.trim(),
        input_variable_name: templateForm.input_variable_name.trim(),
        is_enabled: templateForm.is_enabled,
      });

      const existingDefaultVariables = parseJsonObject(
        templateForm.default_variables_text
      );
      const existingAllowedVariablesSchema = parseJsonObject(
        templateForm.allowed_variables_schema_text
      );
      const existingPromptOverridesSchema = parseJsonObject(
        templateForm.prompt_overrides_schema_text
      );

      const existingOutputMapping = parseJsonObject(templateForm.output_mapping_text);
      const existingStatusMapping = parseJsonObject(templateForm.status_mapping_text);
      const existingExecutionConfig = parseJsonObject(
        templateForm.execution_config_text
      );

      const existingLaunchFields =
        existingExecutionConfig.launch_fields &&
        typeof existingExecutionConfig.launch_fields === "object" &&
        !Array.isArray(existingExecutionConfig.launch_fields)
          ? (existingExecutionConfig.launch_fields as Record<string, unknown>)
          : {};

      const previousRemoteTemplateField = String(
        existingLaunchFields.remote_template_field || ""
      ).trim();

      const nextRemoteTemplateField =
        templateForm.remote_template_field.trim() || previousRemoteTemplateField;
      const targetObjectField =
        templateForm.target_object_field.trim() || "container_id";
      const inputPayloadField =
        templateForm.input_payload_field.trim();
      const inputVariableName =
        templateForm.input_variable_name.trim() || "doko_output";
      const defaultTargetObjectId =
        templateForm.default_target_object_id.trim() || "";

      const existingInputMapping = ensureDokoOutputInputMapping(
        syncRemoteTemplateInputMapping(
          parseJsonObject(templateForm.input_mapping_text),
          previousRemoteTemplateField,
          nextRemoteTemplateField
        )
      );

      const defaultVariables = {
        ...existingDefaultVariables,
      };

      if (defaultTargetObjectId) {
        defaultVariables.target_object_id = defaultTargetObjectId;
        defaultVariables[targetObjectField] = defaultTargetObjectId;
      }

      const launchFields =
        existingExecutionConfig.launch_fields &&
        typeof existingExecutionConfig.launch_fields === "object" &&
        !Array.isArray(existingExecutionConfig.launch_fields)
          ? (existingExecutionConfig.launch_fields as Record<string, unknown>)
          : {};

      const executionConfig = {
        ...existingExecutionConfig,
        launch_fields: {
          ...launchFields,
          remote_template_field:
            templateForm.remote_template_field.trim() || "playbook_id",
          target_object_field: targetObjectField,
          input_payload_field: inputPayloadField,
          input_variable_name: inputVariableName,
        },
      };

      const payload = editingTemplateId
        ? {
            ...basePayload,
            command_help: templateForm.command_help,
            ai_context: templateForm.ai_context,
            entity_type: templateForm.entity_type,
            target_kind: templateForm.target_kind,
            default_variables: defaultVariables,
            allowed_variables_schema: existingAllowedVariablesSchema,
            prompt_overrides_schema: existingPromptOverridesSchema,
            input_mapping: existingInputMapping,
            output_mapping: existingOutputMapping,
            status_mapping: existingStatusMapping,
            execution_config: executionConfig,
            max_time_range_hours: templateForm.max_time_range_hours,
            risk_level: templateForm.risk_level,
          }
        : basePayload;

      if (editingTemplateId) {
        await updateInvestigationTemplate(editingTemplateId, payload);
        toast.push({
          kind: "success",
          title: "AI & SOAR",
          message: "Investigation template updated",
        });
      } else {
        await createInvestigationTemplate(payload);
        toast.push({
          kind: "success",
          title: "AI & SOAR",
          message: "Investigation template created",
        });
      }

      closeTemplateForm();
      await loadAll();
      setTab("templates");
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "AI & SOAR",
        message: formatApiError(
          e,
          editingTemplateId
            ? "Unable to update investigation template"
            : "Unable to create investigation template"
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!canManage || !editingTemplateId) return;

    const current = templates.find((t) => t.id === editingTemplateId);
    const confirmed = window.confirm(
      `Delete investigation template "${current?.name || "this template"}"?`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteInvestigationTemplate(editingTemplateId);
      toast.push({
        kind: "success",
        title: "AI & SOAR",
        message: "Investigation template deleted",
      });
      closeTemplateForm();
      await loadAll();
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "AI & SOAR",
        message:
          e?.response?.data?.detail ||
          e?.message ||
          "Unable to delete investigation template",
      });
    } finally {
      setDeleting(false);
    }
  }

  const sortedSoarProviders = useMemo(
    () =>
      soarProviders.slice().sort((a, b) => {
        const byName = (a.name || "").localeCompare(b.name || "");
        if (byName !== 0) return byName;
        return (a.code || "").localeCompare(b.code || "");
      }),
    [soarProviders]
  );

  const isEditingSoar = !!editingSoarId;


  const sortedTemplates = useMemo(
    () =>
      templates.slice().sort((a, b) => {
        const byName = (a.name || "").localeCompare(b.name || "");
        if (byName !== 0) return byName;
        return (a.code || "").localeCompare(b.code || "");
      }),
    [templates]
  );

  const isEditingTemplate = !!editingTemplateId;


  if (!canManage) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          AI & SOAR
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
            AI & SOAR
          </h1>
          <div className="mt-1 text-sm text-muted-foreground">
            Dedicated configuration for LLM provider, SOAR provider and investigation templates.
          </div>
        </div>

        {tab === "soar" ? (
          <NewGenButton
            type="button"
            onClick={openCreateSoarForm}
            disabled={loading || saving || deleting || !canManage}
            iconOnly={false}
            label="Add SOAR provider"
            title="Add SOAR provider"
          />
        ) : null}

        {tab === "templates" ? (
          <NewGenButton
            type="button"
            onClick={openCreateTemplateForm}
            disabled={loading || saving || deleting || !canManage}
            iconOnly={false}
            label="Add investigation template"
            title="Add investigation template"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "llm", label: "LLM Provider" },
          { key: "soar", label: "SOAR Provider" },
          { key: "templates", label: "Investigation Templates" },
        ].map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={[
                "flex-1 border-none py-3 text-sm hover:bg-slate-800 hover:text-white font-semibold cursor-pointer transition-all duration-200 rounded-xl border-2 hover:-translate-y-1 active:scale-95",
                active
                  ? "bg-slate-800 text-white shadow-md hover:shadow-xl transform auto-scale-95"
                  : "border-gray-100 bg-white shadow-md hover:shadow-xl hover:bg-slate-100 text-slate-500 hover:border-gray-300 hover:text-slate-700",
              ].join(" ")}
              onClick={() => setTab(item.key as "llm" | "soar" | "templates")}
            >
              {item.label}
            </button>
          );
        })}
      </div>


      {tab === "soar" && showSoarForm
        ? createPortal(
            <div className="fixed inset-0 z-[110]">
              <button
                type="button"
                className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
                onClick={() => {
                  if (!(saving || deleting)) {
                    closeSoarForm();
                  }
                }}
                aria-label="Close SOAR provider modal"
                disabled={saving || deleting}
              />

              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                <div className="pointer-events-auto flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
                  <div className="border-b border-border px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-foreground">
                          {isEditingSoar ? "Edit SOAR provider" : "New SOAR provider"}
                        </div>
                        <SectionHint>
                          Configure a SOAR provider that investigation templates can use.
                        </SectionHint>
                      </div>

                      <CancelButton
                        type="button"
                        onClick={closeSoarForm}
                        disabled={saving || deleting || !canManage}
                        title="Cancel"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto px-5 py-5">
                    <div className="mt-6 grid gap-4 xl:grid-cols-2">
                      <label className="space-y-2">
                        <FieldLabel required>Name</FieldLabel>
                        <SettingInput
                          value={soarForm.name}
                          disabled={!canManage || saving || deleting}
                          onChange={(e) =>
                            setSoarForm((p) => ({ ...p, name: e.target.value }))
                          }
                        />
                      </label>

                      <label className="space-y-2">
                        <FieldLabel>Timeout (seconds)</FieldLabel>
                        <SettingInput
                          type="number"
                          min={1}
                          value={soarForm.timeout_seconds}
                          disabled={!canManage || saving || deleting}
                          onChange={(e) =>
                            setSoarForm((p) => ({
                              ...p,
                              timeout_seconds: Number(e.target.value),
                            }))
                          }
                        />
                      </label>

                      <label className="space-y-2 xl:col-span-2">
                        <FieldLabel required>Base URL</FieldLabel>
                        <SettingInput
                          value={soarForm.base_url}
                          disabled={!canManage || saving || deleting}
                          onChange={(e) =>
                            setSoarForm((p) => ({ ...p, base_url: e.target.value }))
                          }
                        />
                      </label>

                      <label className="space-y-2">
                        <FieldLabel required>Auth type</FieldLabel>
                        <SettingSelect
                          value={soarForm.auth_type}
                          disabled={!canManage || saving || deleting}
                          onChange={(e) =>
                            setSoarForm((p) => ({ ...p, auth_type: e.target.value }))
                          }
                        >
                          <option value="none">none</option>
                          <option value="bearer">jwt / bearer</option>
                          <option value="basic">basic</option>
                          <option value="header">header</option>
                        </SettingSelect>
                      </label>

                      <label className="space-y-2">
                        <FieldLabel>Type of authentication token</FieldLabel>
                        <SettingInput
                          value={soarForm.auth_token_type}
                          disabled={
                            !canManage ||
                            saving ||
                            deleting ||
                            !["header"].includes(soarForm.auth_type)
                          }
                          onChange={(e) =>
                            setSoarForm((p) => ({ ...p, auth_token_type: e.target.value }))
                          }
                          placeholder="X-N8N-API-KEY"
                        />
                      </label>

                      <label className="space-y-2 xl:col-span-2">
                        <FieldLabel>Username (for HTTP basic auth)</FieldLabel>
                        <SettingInput
                          value={soarForm.auth_username}
                          disabled={
                            !canManage ||
                            saving ||
                            deleting ||
                            soarForm.auth_type !== "basic"
                          }
                          onChange={(e) =>
                            setSoarForm((p) => ({ ...p, auth_username: e.target.value }))
                          }
                          placeholder="username"
                        />
                      </label>

                      <label className="space-y-2 xl:col-span-2">
                        <FieldLabel>Value of token/password/API Key</FieldLabel>
                        <SettingInput
                          type="password"
                          autoComplete="new-password"
                          value={soarForm.api_key}
                          disabled={
                            !canManage ||
                            saving ||
                            deleting ||
                            soarForm.auth_type === "none"
                          }
                          onChange={(e) =>
                            setSoarForm((p) => ({ ...p, api_key: e.target.value }))
                          }
                          placeholder={isEditingSoar ? "Leave empty to keep current value" : ""}
                        />
                      </label>

                      <div className="xl:col-span-2">
                        <SettingCheckbox
                          checked={soarForm.is_enabled}
                          disabled={!canManage || saving || deleting}
                          onChange={(next) =>
                            setSoarForm((p) => ({ ...p, is_enabled: next }))
                          }
                          label="Enabled"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
                    <div>
                      {isEditingSoar ? (
                        <DeleteButton
                          type="button"
                          onClick={() => void handleDeleteSoar()}
                          disabled={saving || deleting || !canManage}
                          title="Delete SOAR provider"
                        />
                      ) : null}
                    </div>

                    <SaveButton
                      type="button"
                      onClick={() => void handleSaveSoar()}
                      disabled={saving || deleting || !canManage}
                      iconOnly={true}
                      label={
                        saving
                          ? isEditingSoar
                            ? "Saving…"
                            : "Creating…"
                          : isEditingSoar
                            ? "Save"
                            : "Create"
                      }
                      title={isEditingSoar ? "Save SOAR provider" : "Create SOAR provider"}
                    >
                      {saving
                        ? isEditingSoar
                          ? "Saving…"
                          : "Creating…"
                        : isEditingSoar
                          ? "Save"
                          : "Create"}
                    </SaveButton>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}


      {tab === "templates" && showTemplateForm
        ? createPortal(
            <div className="fixed inset-0 z-[110]">
              <button
                type="button"
                className="absolute inset-0 z-0 m-0 h-full w-full cursor-default appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
                onClick={() => {
                  if (!(saving || deleting)) {
                    closeTemplateForm();
                  }
                }}
                aria-label="Close investigation template modal"
                disabled={saving || deleting}
              />

              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                <div className="pointer-events-auto flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
                  <div className="border-b border-border px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-lg font-semibold text-foreground">
                {isEditingTemplate
                  ? "Edit investigation template"
                  : "New investigation template"}
              </div>
              <SectionHint>
                Create a controlled template that the assistant can run safely.
              </SectionHint>
            </div>

            <CancelButton
              type="button"
              onClick={closeTemplateForm}
              disabled={saving || deleting || !canManage}
              title="Cancel"
            />
          </div>
          </div>

          <div className="flex-1 overflow-auto px-5 py-5">
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <label className="space-y-2">
              <FieldLabel required>Name</FieldLabel>
              <SettingInput
                value={templateForm.name}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({ ...p, name: e.target.value }))
                }
              />
            </label>


            <label className="space-y-2">
              <FieldLabel>Chat command</FieldLabel>
              <SettingInput
                value={templateForm.chat_command}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({ ...p, chat_command: e.target.value }))
                }
                placeholder="/user_activity"
              />
            </label>


            <label className="space-y-2">
              <FieldLabel required>SOAR provider</FieldLabel>
              <SettingSelect
                value={templateForm.soar_provider}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({ ...p, soar_provider: e.target.value }))
                }
              >
                <option value="">Select a SOAR provider</option>
                {soarProviders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SettingSelect>
            </label>


            <label className="space-y-2 xl:col-span-2">
              <FieldLabel>Playbook / workflow name</FieldLabel>
              <SettingInput
                value={templateForm.remote_template_code}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({
                    ...p,
                    remote_template_code: e.target.value,
                  }))
                }
              />
            </label>

            <div className="grid gap-4 xl:col-span-2 xl:grid-cols-2">
              <label className="space-y-2">
                <FieldLabel>Playbook / workflow API field</FieldLabel>
                <SettingInput
                  value={templateForm.remote_template_field}
                  disabled={!canManage || saving || deleting}
                  onChange={(e) =>
                    setTemplateForm((p) => ({
                      ...p,
                      remote_template_field: e.target.value,
                    }))
                  }
                  placeholder="playbook_id"
                />
              </label>

              <label className="space-y-2">
                <FieldLabel>Target object payload field</FieldLabel>
                <SettingInput
                  value={templateForm.target_object_field}
                  disabled={!canManage || saving || deleting}
                  onChange={(e) =>
                    setTemplateForm((p) => ({
                      ...p,
                      target_object_field: e.target.value,
                    }))
                  }
                  placeholder="container_id, case_id, incident_id..."
                />
              </label>


            <div className="grid gap-4 md:grid-cols-2 xl:col-span-2">
              <label className="space-y-2">
                <FieldLabel>Input payload API field</FieldLabel>
                <SettingInput
                  value={templateForm.input_payload_field}
                  disabled={!canManage || saving || deleting}
                  onChange={(e) =>
                    setTemplateForm((p) => ({
                      ...p,
                      input_payload_field: e.target.value,
                    }))
                  }
                  placeholder="inputs"
                />
                <SectionHint>
                  Top-level payload field used to pass inputs to the remote playbook or workflow.
                </SectionHint>
              </label>

              <label className="space-y-2">
                <FieldLabel>Input variable name</FieldLabel>
                <SettingInput
                  value={templateForm.input_variable_name}
                  disabled={!canManage || saving || deleting}
                  onChange={(e) =>
                    setTemplateForm((p) => ({
                      ...p,
                      input_variable_name: e.target.value,
                    }))
                  }
                  placeholder="doko_output"
                />
                <SectionHint>
                  Variable name sent inside the input payload field.
                </SectionHint>
              </label>
            </div>


            </div>

            <label className="space-y-2 xl:col-span-2">
              <FieldLabel>Default target object id</FieldLabel>
              <SettingInput
                value={templateForm.default_target_object_id}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({
                    ...p,
                    default_target_object_id: e.target.value,
                  }))
                }
                placeholder="Optional. Example: 47005"
              />
              <SectionHint>
                Leave empty when the target object id is provided at runtime by the case, alert, hunt, or automation context.
              </SectionHint>
            </label>

            <label className="space-y-2 xl:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <SettingTextarea
                rows={4}
                value={templateForm.description}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({ ...p, description: e.target.value }))
                }
              />
            </label>

            <label className="space-y-2 xl:col-span-2">
              <FieldLabel>Selection hint</FieldLabel>
              <SettingTextarea
                rows={4}
                value={templateForm.selection_hint}
                disabled={!canManage || saving || deleting}
                onChange={(e) =>
                  setTemplateForm((p) => ({
                    ...p,
                    selection_hint: e.target.value,
                  }))
                }
                placeholder='Example: Use this template when the user asks to search account activity on Splunk or explicitly says "on Splunk". Extract the variable "account".'
              />
            </label>

            <div className="flex items-end">
              <SettingCheckbox
                checked={templateForm.is_enabled}
                disabled={!canManage || saving || deleting}
                onChange={(next) =>
                  setTemplateForm((p) => ({ ...p, is_enabled: next }))
                }
                label="Enabled"
              />
            </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
            <div>
              {isEditingTemplate ? (
                <DeleteButton
                  type="button"
                  onClick={() => void handleDeleteTemplate()}
                  disabled={saving || deleting || !canManage}
                  title="Delete template"
                />
              ) : null}
            </div>

            <SaveButton
              type="button"
              onClick={() => void handleSaveTemplate()}
              disabled={saving || deleting || !canManage}
              iconOnly={true}
              label={
                saving
                  ? isEditingTemplate
                    ? "Saving…"
                    : "Creating…"
                  : isEditingTemplate
                    ? "Save"
                    : "Create"
              }
              title={isEditingTemplate ? "Save template" : "Create template"}
            >
              {saving
                ? isEditingTemplate
                  ? "Saving…"
                  : "Creating…"
                : isEditingTemplate
                  ? "Save"
                  : "Create"}
            </SaveButton>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null}

      {loading ? (
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">
            Loading configuration…
          </div>
        </Card>
      ) : null}

      {!loading && tab === "llm" ? (
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-lg font-semibold text-foreground">
                LLM Provider
              </div>
              <SectionHint>
                Configure the single LLM provider used by the assistant.
              </SectionHint>
            </div>

            <ConfigStatusBadge enabled={llmForm.is_enabled} />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <label className="space-y-2">
              <FieldLabel required>Name</FieldLabel>
              <SettingInput
                value={llmForm.name}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setLlmForm((p) => ({ ...p, name: e.target.value }))
                }
              />
            </label>

            <label className="space-y-2">
              <FieldLabel required>Default model</FieldLabel>
              <SettingInput
                value={llmForm.default_model}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setLlmForm((p) => ({ ...p, default_model: e.target.value }))
                }
              />
            </label>

            <label className="space-y-2">
              <FieldLabel>Timeout (seconds)</FieldLabel>
              <SettingInput
                type="number"
                min={1}
                value={llmForm.timeout_seconds}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setLlmForm((p) => ({
                    ...p,
                    timeout_seconds: Number(e.target.value),
                  }))
                }
              />
            </label>

            <div />

            <label className="space-y-2 xl:col-span-2">
              <FieldLabel required>Base URL</FieldLabel>
              <SettingInput
                value={llmForm.base_url}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setLlmForm((p) => ({ ...p, base_url: e.target.value }))
                }
              />
            </label>

            <label className="space-y-2 xl:col-span-2">
              <FieldLabel>Default system prompt</FieldLabel>
              <SettingTextarea
                rows={6}
                value={llmForm.default_system_prompt}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setLlmForm((p) => ({ ...p, default_system_prompt: e.target.value }))
                }
              />
            </label>

            <label className="space-y-2 xl:col-span-2">
              <FieldLabel>API key</FieldLabel>
              <SettingInput
                type="password"
                autoComplete="new-password"
                value={llmForm.api_key}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setLlmForm((p) => ({ ...p, api_key: e.target.value }))
                }
                placeholder={singleLlmProvider ? "Leave empty to keep current key" : ""}
              />
            </label>

            <div className="xl:col-span-2">
              <SettingCheckbox
                checked={llmForm.is_enabled}
                disabled={!canManage || saving}
                onChange={(next) =>
                  setLlmForm((p) => ({ ...p, is_enabled: next }))
                }
                label="Enabled"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <SaveButton
              type="button"
              onClick={() => void handleCreateLlm()}
              disabled={saving || !canManage}
              iconOnly={true}
              label={saving ? "Saving…" : "Save"}
              title="Save LLM provider"
            >
              {saving ? "Saving…" : "Save"}
            </SaveButton>
          </div>
        </Card>
      ) : null}

      {!loading && tab === "soar" ? (
        sortedSoarProviders.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sortedSoarProviders.map((item) => (
              <Card key={item.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-foreground">
                      {item.name}
                    </div>
                    <div className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {item.code}
                    </div>
                  </div>

                  <ConfigStatusBadge
                    enabled={!!item.is_enabled}
                    label={item.is_enabled ? "Enabled" : "Disabled"}
                  />
                </div>

                <div className="mt-4 line-clamp-2 text-sm text-muted-foreground">
                  {item.base_url || "No base URL configured"}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                    {item.provider_kind || "generic_http"}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                    {item.auth_type || "bearer"}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                    {item.timeout_seconds || 60}s
                  </span>
                </div>

                <div className="mt-5 flex justify-end">
                  <EditGenButton
                    type="button"
                    onClick={() => openEditSoarForm(item)}
                    title={`Edit ${item.name}`}
                  >
                    Edit
                  </EditGenButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-5">
            <div className="text-sm font-medium text-foreground">
              No SOAR provider configured
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              SOAR providers define the remote systems used by investigation templates.
            </div>
          </Card>
        )
      ) : null}

      {!loading && tab === "templates" ? (
        sortedTemplates.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sortedTemplates.map((item) => (
              <Card key={item.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-foreground">
                      {item.name}
                    </div>
                    <div className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {item.code}
                    </div>
                  </div>

                  <ConfigStatusBadge
                    enabled={!!item.is_enabled}
                    label={item.is_enabled ? "Enabled" : "Disabled"}
                  />
                </div>

                <div className="mt-4 line-clamp-3 text-sm text-muted-foreground">
                  {item.description || "No description"}
                </div>


                {item.selection_hint ? (
                  <div className="mt-3 line-clamp-3 text-xs text-muted-foreground">
                    Trigger: {item.selection_hint}
                  </div>
                ) : null}

                {item.chat_command ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Action: <span className="font-medium text-foreground">{item.chat_command}</span>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                    {item.entity_type}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                    {item.risk_level}
                  </span>
                </div>

                <div className="mt-5 flex justify-end">
                  <EditGenButton
                    type="button"
                    onClick={() => openEditTemplateForm(item)}
                    title={`Edit ${item.name}`}
                  >
                    Edit
                  </EditGenButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-5">
            <div className="text-sm font-medium text-foreground">
              No investigation template configured
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Templates define the controlled investigations the assistant is allowed to run.
            </div>
          </Card>
        )
      ) : null}
    </div>
  );
}