import { api } from "./client";
import { ensureCsrf } from "./auth";

export type AutomationScope = "alert" | "case" | "hunt";
export type AutomationConditionOperator =
  | "EQUAL"
  | "NOT EQUAL"
  | "CONTAINS"
  | "DOES NOT CONTAIN"
  | "GREATER THAN"
  | "LESS THAN"
  | "BETWEEN";
export type AutomationGroupOperator = "AND" | "OR";

export type AutomationConditionNode =
  | {
      operator: AutomationGroupOperator;
      children: AutomationConditionNode[];
    }
  | {
      field: string;
      operator: AutomationConditionOperator;
      value: string | { from?: string; to?: string };
    };

export type AutomationInvestigationTargetSource =
  | "all_iocs"
  | "all_assets"
  | "all_iocs_and_assets"
  | "specific_ioc"
  | "specific_asset"
  | "description"
  | "manual"
  | "trigger_asset"
  | "trigger_ioc"
  | "first_asset"
  | "first_ioc";

export type AutomationAction = {
  type: string;
  target_source?: AutomationInvestigationTargetSource;
  target_value?: string;
  target_type?: string;
  post_result_comment?: boolean;
  post_result_comment_mode?: "raw" | "chatbot";
  variables?: Record<string, any>;
  [key: string]: any;
};

export type AutomationRule = {
  id: string;
  name: string;
  scope: AutomationScope;
  is_enabled: boolean;
  conditions: AutomationConditionNode;
  actions: AutomationAction[];
  run_once_per_target: boolean;
  cooldown_seconds: number;
  stop_on_first_action_error: boolean;
  created_at?: string;
  updated_at?: string;
  created_by_username?: string;
  updated_by_username?: string;
};

export type AutomationRulesResponse = {
  results: AutomationRule[];
  count: number;
};

export type AutomationRuleMetadata = {
  scopes: Array<{ value: AutomationScope; label: string }>;
  operators: AutomationConditionOperator[];
  condition_fields: Array<{ value: string; label: string }>;
  event_values: Array<{ value: string; label: string; scopes?: AutomationScope[] }>;
  statuses: Record<AutomationScope, Array<{ value: string; label: string }>>;
  severities: Array<{ code: string; label: string }>;
  classifications: Array<{ code: string; label: string }>;
  customers: Array<{ id: string; name: string }>;
  users: Array<{ id: number | string; username: string }>;
  workbooks: Array<{ id: string; name: string }>;
  quickparts: Array<{ id: string; name: string }>;
  investigation_templates: Array<{
    id: string;
    code: string;
    name: string;
    chat_command?: string;
    entity_type?: string;
    target_kind?: string;
    allowed_variables_schema?: Record<string, any>;
  }>;
};

export async function listAutomationRules(params?: {
  q?: string;
  scope?: string;
  include_inactive?: boolean;
}) {
  const res = await api.get(`/api/settings/automation-rules/`, {
    params: {
      q: params?.q || undefined,
      scope: params?.scope || undefined,
      include_inactive: params?.include_inactive ? "1" : undefined,
    },
  });

  return res.data as AutomationRulesResponse;
}

export async function getAutomationRule(id: string) {
  const res = await api.get(`/api/settings/automation-rules/${id}/`);
  return res.data as AutomationRule;
}

export async function createAutomationRule(payload: Partial<AutomationRule>) {
  const csrfToken = await ensureCsrf();

  const res = await api.post(`/api/settings/automation-rules/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });

  return res.data as AutomationRule;
}

export async function updateAutomationRule(
  id: string,
  payload: Partial<AutomationRule>
) {
  const csrfToken = await ensureCsrf();

  const res = await api.patch(`/api/settings/automation-rules/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });

  return res.data as AutomationRule;
}

export async function deleteAutomationRule(id: string) {
  const csrfToken = await ensureCsrf();

  await api.delete(`/api/settings/automation-rules/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function getAutomationRuleMetadata() {
  const res = await api.get(`/api/settings/automation-rules/metadata/`);
  return res.data as AutomationRuleMetadata;
}