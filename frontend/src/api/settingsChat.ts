import { api } from "./client";
import { ensureCsrf } from "./auth";

type Paginated<T> = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
};

function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }

  if (
    data &&
    typeof data === "object" &&
    "results" in data &&
    Array.isArray((data as Paginated<T>).results)
  ) {
    return (data as Paginated<T>).results;
  }

  return [];
}

export type AIProvider = {
  id: string;
  name: string;
  code: string;
  provider_kind: string;
  base_url: string;
  default_model: string;
  default_system_prompt: string;
  timeout_seconds: number;
  is_enabled: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export type SOARProvider = {
  id: string;
  name: string;
  code: string;
  provider_kind: string;
  base_url: string;
  auth_type: string;
  auth_config: Record<string, unknown>;
  request_config: Record<string, unknown>;
  response_config: Record<string, unknown>;
  status_config: Record<string, unknown>;
  timeout_seconds: number;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

export type InvestigationTemplate = {
  id: string;
  code: string;
  name: string;
  description: string;
  selection_hint: string;
  chat_command: string;
  command_help: string;
  ai_context: string;
  entity_type: string;
  target_kind: string;
  soar_provider: string;
  remote_template_code: string;
  default_variables: Record<string, unknown>;
  allowed_variables_schema: Record<string, unknown>;
  prompt_overrides_schema: Record<string, unknown>;
  input_mapping: Record<string, unknown>;
  output_mapping: Record<string, unknown>;
  status_mapping: Record<string, unknown>;
  execution_config: Record<string, unknown>;
  max_time_range_hours: number;
  risk_level: string;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CreateAIProviderPayload = {
  name: string;
  code: string;
  provider_kind: string;
  base_url: string;
  default_model: string;
  default_system_prompt: string;
  timeout_seconds: number;
  is_enabled: boolean;
  is_default: boolean;
  api_key?: string;
};

export type CreateSOARProviderPayload = {
  name: string;
  code: string;
  provider_kind: string;
  base_url: string;
  auth_type: string;
  auth_config: Record<string, unknown>;
  request_config: Record<string, unknown>;
  response_config: Record<string, unknown>;
  status_config: Record<string, unknown>;
  timeout_seconds: number;
  is_enabled: boolean;
  api_key?: string;
};

export type CreateInvestigationTemplatePayload = {
  code: string;
  name: string;
  description: string;
  selection_hint: string;
  chat_command: string;
  command_help: string;
  ai_context: string;
  entity_type: string;
  target_kind: string;
  soar_provider: string;
  remote_template_code: string;
  default_variables: Record<string, unknown>;
  allowed_variables_schema: Record<string, unknown>;
  prompt_overrides_schema: Record<string, unknown>;
  input_mapping: Record<string, unknown>;
  output_mapping: Record<string, unknown>;
  status_mapping: Record<string, unknown>;
  execution_config: Record<string, unknown>;
  max_time_range_hours: number;
  risk_level: string;
  is_enabled: boolean;
};


export type SimpleSOARProviderPayload = {
  name: string;
  base_url: string;
  auth_type: string;
  auth_token_type?: string;
  auth_username?: string;
  timeout_seconds: number;
  is_enabled: boolean;
  api_key?: string;
};

export type SimpleInvestigationTemplatePayload = {
  name: string;
  description: string;
  selection_hint: string;
  chat_command: string;
  soar_provider: string;
  remote_template_code: string;
  remote_template_field: string;
  target_object_field: string;
  default_target_object_id: string;
  input_payload_field: string;
  input_variable_name: string;
  is_enabled: boolean;
};


export function buildSimpleSOARPayload(
  payload: SimpleSOARProviderPayload
): CreateSOARProviderPayload {
  const authType = payload.auth_type || "none";
  const authTokenType = (payload.auth_token_type || "").trim();
  const authUsername = (payload.auth_username || "").trim();

  const authConfig: Record<string, unknown> = {};

  if (authType === "header" && authTokenType) {
    authConfig.header_name = authTokenType;
    authConfig.header_prefix = "";
  }

  if (authType === "basic" && authUsername) {
    authConfig.username = authUsername;
  }

  return {
    name: payload.name,
    code: payload.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80),
    provider_kind: "generic_http",
    base_url: payload.base_url,
    auth_type: authType,
    auth_config: authConfig,
    request_config: {},
    response_config: {},
    status_config: {},
    timeout_seconds: payload.timeout_seconds,
    is_enabled: payload.is_enabled,
    api_key: payload.api_key,
  };
}



export function buildSimpleInvestigationTemplatePayload(
  payload: SimpleInvestigationTemplatePayload
): CreateInvestigationTemplatePayload {
  const code = payload.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const remoteTemplateField =
    payload.remote_template_field?.trim() || "";
  const targetObjectField =
    payload.target_object_field?.trim() || "";
  const defaultTargetObjectId =
    payload.default_target_object_id?.trim() || "";

  const inputPayloadField =
    payload.input_payload_field?.trim() || "";

  const inputVariableName =
    payload.input_variable_name?.trim() || "doko_output";

  return {
    code,
    name: payload.name,
    description: payload.description,
    selection_hint: payload.selection_hint,
    chat_command: payload.chat_command,
    command_help: "",
    ai_context: "",
    entity_type: "generic",
    target_kind: "single",
    soar_provider: payload.soar_provider,
    remote_template_code: payload.remote_template_code || code,
    default_variables: defaultTargetObjectId
      ? {
          target_object_id: defaultTargetObjectId,
          [targetObjectField]: defaultTargetObjectId,
        }
      : {},
    allowed_variables_schema: {},
    prompt_overrides_schema: {},
    input_mapping: {
      ...(remoteTemplateField
        ? {
            [remoteTemplateField]: {
              fallback_template_field: "remote_template_code",
            },
          }
        : {}),
      ...(targetObjectField
        ? {
            [targetObjectField]: {
              from_variable: "target_object_id",
            },
          }
        : {}),
      doko_output: {
        from_variable: "doko_output",
      },
      ...(inputPayloadField
        ? {
            [inputPayloadField]: {
              [inputVariableName]: {
                from_variable: "doko_output",
              },
            },
          }
        : {}),
      observable_value: {
        from_variable: "observable_value",
      },
      observable_type: {
        from_variable: "observable_type",
      },
    },
    output_mapping: {},
    status_mapping: {},
    execution_config: {
      launch_fields: {
        ...(remoteTemplateField
          ? {
              remote_template_field: remoteTemplateField,
            }
          : {}),
        target_object_field: targetObjectField,
        input_payload_field: inputPayloadField,
        input_variable_name: inputVariableName,
      },
      required_launch_fields: targetObjectField ? [targetObjectField] : [],
    },
    max_time_range_hours: 24,
    risk_level: "low",
    is_enabled: payload.is_enabled,
  };
}


export async function listAIProviders(): Promise<AIProvider[]> {
  const { data } = await api.get("/api/settings/ai/providers");
  return unwrapList<AIProvider>(data);
}

export async function getAIProvider(id: string): Promise<AIProvider> {
  const { data } = await api.get(`/api/settings/ai/providers/${id}`);
  return data;
}

export async function listSOARProviders(): Promise<SOARProvider[]> {
  const { data } = await api.get("/api/settings/soar/providers");
  return unwrapList<SOARProvider>(data);
}

export async function getSOARProvider(id: string): Promise<SOARProvider> {
  const { data } = await api.get(`/api/settings/soar/providers/${id}`);
  return data;
}

export async function listInvestigationTemplates(): Promise<InvestigationTemplate[]> {
  const { data } = await api.get("/api/settings/ai/investigation-templates");
  return unwrapList<InvestigationTemplate>(data);
}

export async function getInvestigationTemplate(id: string): Promise<InvestigationTemplate> {
  const { data } = await api.get(`/api/settings/ai/investigation-templates/${id}`);
  return data;
}

export async function createAIProvider(payload: CreateAIProviderPayload): Promise<AIProvider> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post("/api/settings/ai/providers", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function createSOARProvider(payload: CreateSOARProviderPayload): Promise<SOARProvider> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post("/api/settings/soar/providers", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function createInvestigationTemplate(
  payload: CreateInvestigationTemplatePayload
): Promise<InvestigationTemplate> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.post("/api/settings/ai/investigation-templates", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function updateAIProvider(
  id: string,
  payload: Partial<{
    name: string;
    code: string;
    provider_kind: string;
    base_url: string;
    default_model: string;
    default_system_prompt: string;
    timeout_seconds: number;
    is_enabled: boolean;
    is_default: boolean;
    api_key?: string;
  }>
): Promise<AIProvider> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.patch(`/api/settings/ai/providers/${id}`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function updateSOARProvider(
  id: string,
  payload: Partial<{
    name: string;
    code: string;
    provider_kind: string;
    base_url: string;
    auth_type: string;
    auth_config: Record<string, unknown>;
    request_config: Record<string, unknown>;
    response_config: Record<string, unknown>;
    status_config: Record<string, unknown>;
    timeout_seconds: number;
    is_enabled: boolean;
    api_key?: string;
  }>
): Promise<SOARProvider> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.patch(`/api/settings/soar/providers/${id}`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function updateInvestigationTemplate(
  id: string,
  payload: Partial<{
    code: string;
    name: string;
    description: string;
    selection_hint: string;
    entity_type: string;
    target_kind: string;
    soar_provider: string;
    chat_command: string;
    command_help: string;
    ai_context: string;
    default_variables: Record<string, unknown>;
    prompt_overrides_schema: Record<string, unknown>;
    remote_template_code: string;
    allowed_variables_schema: Record<string, unknown>;
    input_mapping: Record<string, unknown>;
    output_mapping: Record<string, unknown>;
    status_mapping: Record<string, unknown>;
    execution_config: Record<string, unknown>;
    max_time_range_hours: number;
    risk_level: string;
    is_enabled: boolean;
  }>
): Promise<InvestigationTemplate> {
  const csrfToken = await ensureCsrf();
  const { data } = await api.patch(`/api/settings/ai/investigation-templates/${id}`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return data;
}

export async function deleteAIProvider(id: string, force = false): Promise<void> {
  const csrfToken = await ensureCsrf();
  const suffix = force ? "?force=1" : "";
  await api.delete(`/api/settings/ai/providers/${id}${suffix}`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function deleteSOARProvider(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/soar/providers/${id}`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function deleteInvestigationTemplate(id: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/ai/investigation-templates/${id}`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}