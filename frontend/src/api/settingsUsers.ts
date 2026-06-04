import { api } from "./client";
import { ensureCsrf } from "./auth";

export type SettingsUser = {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_staff: boolean;
  role_ids?: number[];
};

export type SettingsUserApiToken = {
  id: string;
  token_key: string;
  created: string;
  expiry: string | null;
};

export async function listSettingsUsers(params?: {
  q?: string;
  include_inactive?: boolean;
}): Promise<{ results: SettingsUser[]; count: number }> {
  const res = await api.get("/api/settings/users/", {
    params: {
      q: params?.q || undefined,
      include_inactive: params?.include_inactive ? "1" : "0",
    },
  });

  return Array.isArray(res.data)
    ? { results: res.data, count: res.data.length }
    : res.data;
}

export async function createSettingsUser(data: {
  username: string;
  email?: string;
  password: string;
  expiresAt?: string | null,
}): Promise<SettingsUser> {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/settings/users/", data, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function resetSettingsUserPassword(
  userId: number,
  password: string
): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/settings/users/${userId}/reset-password/`,
    { password },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function generateSettingsUserResetLink(
  userId: number
): Promise<{
  url: string;
  uid: string;
  token: string;
  expires_in_seconds: number;
}> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/settings/users/${userId}/password-reset-link/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function confirmPasswordReset(payload: {
  uid: string;
  token: string;
  new_password: string;
}): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(`/api/auth/password-reset/confirm/`, payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function disableSettingsUser(userId: number): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/settings/users/${userId}/disable/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export async function updateUser(
  id: number,
  data: {
    username?: string;
    email?: string;
    is_active?: boolean;
    is_staff?: boolean;
    role_ids?: number[];
  }
) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch(`/api/settings/users/${id}/edit/`, data, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function listSettingsUserApiTokens(
  userId: number
): Promise<SettingsUserApiToken[]> {
  const res = await api.get(`/api/settings/users/${userId}/api-tokens/`);
  return res.data;
}

export async function createSettingsUserApiToken(
  userId: number,
  expiresAt?: string | null,
  neverExpire = false
): Promise<{
  id: string;
  token: string;
  token_key: string;
  created: string;
  expiry: string | null;
}> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    `/api/settings/users/${userId}/api-tokens/`,
    {
      expires_at: neverExpire ? null : expiresAt || null,
      never_expire: neverExpire,
    },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
  return res.data;
}

export async function revokeSettingsUserApiToken(
  userId: number,
  tokenId: string
): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/settings/users/${userId}/api-tokens/${tokenId}/revoke/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}