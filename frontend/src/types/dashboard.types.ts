export type DashboardRow = {
  key: string | null;
  label: string;
  value: number;
};

export type DashboardRatePayload = {
  false_positive_count: number;
  true_positive_count: number;
  qualified_total: number;
  rate: number | null;
};

export type DashboardSlaGlobal = {
  configured_customers: number;
  closed_count: number;
  within_sla_count: number;
  breached_count: number;
  sla_rate: number | null;
  avg_resolution_hours: number | null;
};

export type DashboardSlaCustomer = {
  customer_id: string | null;
  customer_name: string;
  sla_hours: number;
  closed_count: number;
  within_sla_count: number;
  breached_count: number;
  avg_resolution_hours: number;
  sla_rate: number | null;
};

export type DashboardWidget = {
  id: string;
  label: string;
  kind: "kpi" | "chart" | "table" | "list" | string;
};

export type DashboardAllowedCustomer = {
  id: string;
  name: string;
  sla?: string;
};

export type DashboardCaseListItem = {
  id: string;
  title: string;
  status: string;
  severity: string;
  updated_at: string;
  customer__name?: string | null;
};

export type DashboardData = {
  scope: {
    customer: string | null;
    period: string;
    date_from: string | null;
    date_to: string | null;
  };
  allowed_customers: DashboardAllowedCustomer[];
  preferences: {
    widgets: string[];
    default_widgets: string[];
  };
  available_widgets: DashboardWidget[];
  kpis: {
    cases_open: number;
    alerts_open: number;
    hunts_open: number;
    cases_closed_period: number;
    alerts_closed_period: number;
    cases_archived_period: number;
    tpwi_cases_period: number;
    alert_fp_rate: DashboardRatePayload;
    case_fp_rate: DashboardRatePayload;
    open_cases_by_severity: DashboardRow[];
    open_alerts_by_severity: DashboardRow[];
  };
  sla: {
    global: DashboardSlaGlobal;
    by_customer: DashboardSlaCustomer[];
  };
  charts: {
    cases_created_closed_series: Array<{
      date: string;
      created: number;
      closed: number;
    }>;
    alerts_created_series: Array<{
      date: string;
      created: number;
    }>;
    cases_by_severity_period: DashboardRow[];
    cases_by_classification_period: DashboardRow[];
    cases_by_outcome_period: DashboardRow[];
    open_cases_by_customer: DashboardRow[];
    open_alerts_by_customer: DashboardRow[];
    open_hunts_by_customer: DashboardRow[];
    alerts_created_by_customer_period: DashboardRow[];
    cases_created_by_customer_period: DashboardRow[];
    tpwi_cases_by_customer_period: DashboardRow[];
  };
  latest_cases: DashboardCaseListItem[];
  personal: {
    my_open_cases: DashboardCaseListItem[];
  };
};