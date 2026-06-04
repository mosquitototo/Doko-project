import { api } from "./client";
import { ensureCsrf } from "./auth";
import type { RunAddonResponse } from "../types/addons.types";

export async function listAddons(): Promise<any[]> {
  const res = await api.get("/api/addons/");
  const d = res.data;

  if (Array.isArray(d)) return d;
  if (Array.isArray((d as any)?.results)) return (d as any).results;

  return [];
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function getAddonInstallSchema(url: string) {
  const trimmed = url.trim();

  if (!isValidHttpUrl(trimmed)) {
    throw new Error("Invalid addon manifest URL.");
  }

  const res = await api.get("/api/addons/install/schema/", {
    params: { url: trimmed },
  });
  return res.data;
}

export async function installAddon(manifest: any): Promise<{ ok: boolean }> {
  const csrfToken = await ensureCsrf();
  const r = await api.post("/api/addons/install/", manifest, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data;
}

export async function uninstallAddon(addonId: string): Promise<void> {
  const csrfToken = await ensureCsrf();
  await api.delete(`/api/addons/${addonId}/uninstall/`, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function patchAddonConfig(
  addonId: string,
  patch: { base_url?: string; secret?: string; is_enabled?: boolean }
) {
  const csrfToken = await ensureCsrf();
  const r = await api.patch(`/api/addons/${addonId}/config/`, patch, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data;
}

export async function runAddonAction(payload: {
  addon_id: string;
  action_id: string;
  scope: "case" | "ioc" | "asset";
  target_id: string;
  context?: any;
}): Promise<RunAddonResponse> {
  const csrfToken = await ensureCsrf();
  const r = await api.post("/api/addons/run/", payload, {
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
  return r.data;
}