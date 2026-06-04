import { api } from "./client";
import { ensureCsrf } from "./auth";

export type PermissionItem = { id: number; code: string; label: string };

export type RoleItem = {
  id: number;
  name: string;
  description: string;
  permissions: PermissionItem[];
};

export async function listPermissions(q?: string): Promise<PermissionItem[]> {
  const res = await api.get("/api/settings/permissions/", {
    params: {
      q: q || undefined,
    },
  });
  return Array.isArray(res.data) ? res.data : res.data?.results ?? [];
}

export async function listRoles(): Promise<RoleItem[]> {
  const res = await api.get("/api/settings/roles/");
  return Array.isArray(res.data) ? res.data : res.data.results ?? [];
}

export async function createRole(data: {
  name: string;
  description?: string;
  permission_ids: number[];
}) {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/settings/roles/", data, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as RoleItem;
}

export async function updateRole(
  id: number,
  data: {
    name?: string;
    description?: string;
    permission_ids?: number[];
  }
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/roles/${id}/`, data, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data as RoleItem;
}

export async function deleteRole(id: number) {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/settings/roles/${id}/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function getRoleCustomerAccess(roleId: number) {
  const r = await api.get(`/api/settings/access/roles/${roleId}/customers/`);
  return r.data as { role_id: number; customer_ids: string[]; customers?: any[] };
}

export async function putRoleCustomerAccess(roleId: number, customerIds: string[]) {
  const csrfToken = await ensureCsrf();
  const r = await api.put(
    `/api/settings/access/roles/${roleId}/customers/`,
    { customer_ids: customerIds },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return r.data as { role_id: number; customer_ids: string[] };
}