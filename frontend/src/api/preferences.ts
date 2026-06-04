import { api } from "./client";
import { ensureCsrf } from "./auth";

export async function updateMe(data: { email?: string; timezone?: string }) {
  const csrfToken = await ensureCsrf();
  const res = await api.patch("/api/me/update/", data, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function changePassword(data: {
  current_password: string;
  new_password: string;
}) {
  const csrfToken = await ensureCsrf();
  const res = await api.post("/api/me/change-password/", data, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export async function uploadAvatar(data: { file: File }) {
  const csrfToken = await ensureCsrf();
  const form = new FormData();
  form.append("avatar", data.file);

  const res = await api.post("/api/me/avatar/", form, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return res.data;
}

export type MyApiToken = {
  id: string;
  token_key: string;
  created: string;
  expiry: string | null;
};

export async function listMyApiTokens(): Promise<MyApiToken[]> {
  const res = await api.get("/api/auth/api-tokens/");
  return Array.isArray(res.data) ? res.data : [];
}

export async function createMyApiToken(
  expiresAt?: string | null,
  neverExpire = false
): Promise<{
  id: number;
  token: string;
  token_key: string;
  created: string;
  expiry: string | null;
}> {
  const csrfToken = await ensureCsrf();
  const res = await api.post(
    "/api/auth/api-tokens/",
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

export async function revokeMyApiToken(tokenKey: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.post(
    `/api/auth/api-tokens/${tokenKey}/revoke/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}