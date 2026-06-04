import axios from "axios";
import { clearToken } from "../auth/auth";

const apiBaseUrl = import.meta.env.VITE_API_URL || "";

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 540000,
  withCredentials: true,
});

function isAuthFailure(err: any) {
  const status = err?.response?.status;
  const code = String(err?.response?.data?.code || "");
  const detail = String(err?.response?.data?.detail || "");

  if (status === 401) return true;
  if (status === 403 && code === "not_authenticated") return true;
  if (
    status === 403 &&
    detail.includes("Authentication credentials were not provided")
  ) {
    return true;
  }

  return false;
}

let handlingAuthFailure = false;

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = String(err?.config?.url || "");
    const isAuthEndpoint =
      url.includes("/api/auth/login/") ||
      url.includes("/api/auth/logout/") ||
      url.includes("/api/auth/csrf/");

    if (!isAuthEndpoint && isAuthFailure(err) && !handlingAuthFailure) {
      handlingAuthFailure = true;
      clearToken();

      if (!window.location.pathname.startsWith("/login")) {
        const next = `${window.location.pathname}${window.location.search || ""}`;
        window.location.assign(`/login?reason=expired&next=${encodeURIComponent(next)}`);
      }
    }

    return Promise.reject(err);
  }
);