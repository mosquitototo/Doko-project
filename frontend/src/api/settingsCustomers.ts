import { api } from "./client";
import { ensureCsrf } from "./auth";

export type CustomerContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  is_active: boolean;
  created_at: string;
};

export type CustomerSlaUnit = "minute" | "hour" | "day" | "week" | "month";

export type CustomerSlaRule = {
  enabled?: boolean;
  value?: number;
  unit?: CustomerSlaUnit;
};

export type CustomerSlaRules = Record<string, CustomerSlaRule>;

export type Customer = {
  id: string;
  name: string;
  sla: string;
  sla_rules?: CustomerSlaRules;
  is_active: boolean;
  created_at: string;
  contacts?: CustomerContact[];
};

export async function listCustomers(params: { q?: string; include_inactive?: boolean } = {}) {
  const res = await api.get("/api/settings/customers/", {
    params: {
      q: params.q || undefined,
      include_inactive: params.include_inactive ? "1" : undefined,
    },
  });
  return Array.isArray(res.data) ? { results: res.data, count: res.data.length } : res.data;
}

export async function createCustomer(payload: {
  name: string;
  sla?: string;
  sla_rules?: CustomerSlaRules;
}) {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/settings/customers/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as Customer;
}

export async function updateCustomer(
  id: string,
  payload: Partial<{
    name: string;
    sla: string;
    sla_rules: CustomerSlaRules;
    is_active: boolean;
  }>
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/customers/${id}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as Customer;
}

export async function disableCustomer(id: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/customers/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function listCustomerContacts(customerId: string, includeInactive: boolean) {
  const res = await api.get(`/api/settings/customers/${customerId}/contacts/`, {
    params: { include_inactive: includeInactive ? "1" : undefined },
  });
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export type CustomerContactPayload = Partial<{
  name: string;
  email: string;
  phone: string;
  title: string;
  is_active: boolean;
}>;

export async function createCustomerContact(customerId: string, payload: CustomerContactPayload) {
  const csrfToken = await ensureCsrf();
  const res = await api.post(`/api/settings/customers/${customerId}/contacts/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function updateCustomerContact(contactId: string, payload: CustomerContactPayload) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/customer-contacts/${contactId}/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function disableCustomerContact(contactId: string) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/customer-contacts/${contactId}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}