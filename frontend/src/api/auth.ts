import { api } from "./client";

function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

export async function ensureCsrf(): Promise<string> {
  const r = await api.get("/api/auth/csrf/");
  return getCookie("csrftoken") || r.data?.csrfToken || "";
}

export async function login(username: string, password: string): Promise<string> {
  const csrfToken = await ensureCsrf();

  await api.post(
    "/api/auth/login/",
    { username, password },
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );

  return "session";
}

export async function logout(): Promise<void> {
  const csrfToken = await ensureCsrf();

  await api.post(
    "/api/auth/logout/",
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}

export type ApiTokenPayload = {
  id: number;
  token: string;
  token_key: string;
  created: string;
  expiry: string | null;
};

export async function createApiToken(): Promise<ApiTokenPayload> {
  const csrfToken = await ensureCsrf();

  const r = await api.post(
    "/api/auth/api-tokens/",
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );

  return r.data as ApiTokenPayload;
}

export async function listApiTokens(): Promise<
  Array<{
    id: number;
    token_key: string;
    created: string;
    expiry: string | null;
  }>
> {
  const r = await api.get("/api/auth/api-tokens/");
  return r.data;
}

export async function revokeApiToken(id: number): Promise<void> {
  const csrfToken = await ensureCsrf();

  await api.post(
    `/api/auth/api-tokens/${id}/revoke/`,
    {},
    {
      headers: {
        "X-CSRFToken": csrfToken,
      },
    }
  );
}