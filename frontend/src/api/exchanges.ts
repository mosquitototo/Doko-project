import { api } from "./client";
import { ensureCsrf } from "./auth";

export type CaseExchange = {
  id: string;
  case: string;

  direction: "inbound" | "outbound";
  channel: "email" | "other";

  subject: string;
  body: string;

  sender: string;
  to: string[];
  cc: string[];
  bcc: string[];

  message_id: string;
  references: string[];
  raw: Record<string, any>;

  followup_config?: CaseExchangeFollowup | null;

  created_by: number | null;
  created_by_username?: string;
  created_at: string;
};

export type CaseExchangeFollowup = {
  id: string;
  enabled: boolean;
  delay_value: number;
  delay_unit: "minute" | "hour" | "day" | "week" | "month";
  quickpart: string | null;
  quickpart_name?: string | null;
  action: "save" | "send";
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listCaseExchanges(caseId: string) {
  const r = await api.get(`/api/cases/${caseId}/exchanges/`);
  return r.data as CaseExchange[];
}

export async function createCaseExchange(caseId: string, payload: Partial<CaseExchange>) {
  const csrfToken = await ensureCsrf();
  const r = await api.post(`/api/cases/${caseId}/exchanges/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as CaseExchange;
}

export async function sendCaseExchange(caseId: string, payload: Partial<CaseExchange>) {
  const csrfToken = await ensureCsrf();

  const r = await api.post(`/api/cases/${caseId}/exchanges/send/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });

  return r.data as CaseExchange;
}

export async function deleteCaseExchange(exchangeId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/exchanges/${exchangeId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function updateCaseExchange(exchange: CaseExchange, payload: Partial<CaseExchange>) {
  const csrfToken = await ensureCsrf();

  const body = {
    case: exchange.case,
    direction: exchange.direction,

    channel: payload.channel ?? exchange.channel,
    sender: payload.sender ?? exchange.sender,
    to: payload.to ?? exchange.to,
    cc: payload.cc ?? exchange.cc,
    bcc: payload.bcc ?? exchange.bcc,
    subject: payload.subject ?? exchange.subject,
    body: payload.body ?? exchange.body,
    message_id: payload.message_id ?? exchange.message_id,
    references: payload.references ?? exchange.references,

    raw: payload.raw ?? exchange.raw ?? {},
  };

  const r = await api.put(`/api/exchanges/${exchange.id}/`, body, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data as CaseExchange;
}

export async function configureCaseExchangeFollowups(
  caseId: string,
  payload: {
    exchange_ids: string[];
    enabled: boolean;
    delay_value: number;
    delay_unit: "minute" | "hour" | "day" | "week" | "month";
    quickpart_id?: string | null;
    action: "save" | "send";
  }
) {
  const csrfToken = await ensureCsrf();

  const r = await api.post(`/api/cases/${caseId}/exchanges/followups/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });

  return r.data as CaseExchangeFollowup[];
}