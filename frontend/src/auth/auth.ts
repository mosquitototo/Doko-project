const SESSION_FLAG_KEY = "doko_session_present";
const LEGACY_TOKEN_KEY = "token";

function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

export function getToken() {
  return localStorage.getItem(SESSION_FLAG_KEY);
}

export function setToken(_token: string) {
  localStorage.setItem(SESSION_FLAG_KEY, "1");
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(SESSION_FLAG_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export async function logoutServer() {
  const baseURL = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const csrfToken = getCookie("csrftoken");
  const headers: Record<string, string> = {};

  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }

  await fetch(`${baseURL}/api/auth/logout/`, {
    method: "POST",
    credentials: "include",
    headers,
  });
}