import { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card";
import { useToast } from "../../components/ui/toast";
import { installAddon, listAddons, patchAddonConfig, uninstallAddon } from "../../api/addons";
import type { Addon } from "../../types/addons.types";

export default function SettingsAddons() {
  const { push } = useToast();
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const a = await listAddons();
      setAddons(a);
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
      setAddons([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installedCount = useMemo(() => addons.length, [addons]);

  async function onUploadManifest(file: File) {
    try {
      const txt = await file.text();
      const json = JSON.parse(txt);
      await installAddon(json);
      push({ kind: "success", title: "Addon installed" });
      await refresh();
    } catch (e: any) {
      push({ kind: "error", title: "Install failed", message: String(e?.message ?? e) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold">Addons</div>
          <div className="text-sm text-gray-600">{installedCount} installed</div>
        </div>

        <label className="cursor-pointer rounded-lg border bg-white px-3 py-2 text-sm hover:bg-gray-50 shadow-md">
          Upload addon (JSON)
          <input
            type="file"
            className="hidden"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void onUploadManifest(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      {loading ? (
        <Card>
          <div className="py-6 text-sm text-gray-600">Loading…</div>
        </Card>
      ) : addons.length === 0 ? (
        <Card>
          <div className="py-6 text-sm text-gray-600">No addon installed.</div>
        </Card>
      ) : (
        <div className="space-y-4">
          {addons.map((a) => (
            <AddonCard key={a.id} addon={a} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddonCard({ addon, onChanged }: { addon: Addon; onChanged: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const [baseUrl, setBaseUrl] = useState(addon.base_url || "");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(!!addon.is_enabled);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setBaseUrl(addon.base_url || "");
    setEnabled(!!addon.is_enabled);
    setSecret("");
  }, [addon.id]);

  async function saveConfig() {
    setBusy(true);
    try {
      await patchAddonConfig(addon.id, {
        base_url: baseUrl.trim(),
        secret: secret.trim() ? secret.trim() : undefined,
        is_enabled: enabled,
      });
      push({ kind: "success", title: "Saved" });
      await onChanged();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.data?.detail ?? e?.response?.status ?? "network") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await uninstallAddon(addon.id);
      push({ kind: "success", title: "Uninstalled" });
      await onChanged();
    } catch (e: any) {
      push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
    } finally {
      setBusy(false);
    }
  }

  return (
<Card>
  <div 
    className="flex flex-wrap items-start justify-between gap-3 w-full min-w-0 cursor-pointer select-none"
    onClick={() => setIsExpanded(!isExpanded)}
  >
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
        <div className="text-lg font-semibold truncate">{addon.name}</div>
      </div>
      <div className="text-xs text-gray-500 truncate ml-4">
        {addon.id} • v{addon.version}
      </div>
      {!isExpanded && (
        <div className="mt-1 text-xs text-gray-400 ml-4">
          {addon.actions?.length ?? 0} actions available
        </div>
      )}
    </div>

    <div className="flex items-center gap-2 shrink-0">
      <button
        className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50 transition active:scale-95"
        onClick={(e) => {
          e.stopPropagation();
          remove();
        }}
        disabled={busy}
      >
        Uninstall
      </button>
    </div>
  </div>

  {isExpanded && (
    <div className="mt-4 pt-4 border-t w-full min-w-0">
      
      {addon.description && (
        <div className="mb-4 text-sm text-gray-700 break-words">
          {addon.description}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2 w-full min-w-0">
        <div className="min-w-0">
          <label className="mb-1 block text-xs font-semibold text-gray-600">Base URL (https)</label>
          <input
            className="w-full box-border rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 disabled:opacity-50"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={busy}
            placeholder="https://connector.example.com"
          />
          <div className="mt-1 text-[11px] text-gray-500">
            Host privé / localhost bloqués côté serveur.
          </div>
        </div>

        <div className="min-w-0">
          <label className="mb-1 block text-xs font-semibold text-gray-600">Secret (HMAC)</label>
          <input
            className="w-full box-border rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 disabled:opacity-50"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            disabled={busy}
            placeholder="(leave empty to keep unchanged)"
          />
          <div className="mt-1 text-[11px] text-gray-500">
            On ne ré-affiche pas le secret stocké.
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 w-full min-w-0">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
          />
          Enabled
        </label>

        <button
          className="rounded-lg border bg-slate-700 px-3 py-2 text-xs text-white disabled:opacity-50 transition shadow-md hover:-translate-y-1 active:scale-95"
          onClick={saveConfig}
          disabled={busy || !baseUrl.trim()}
          type="button"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {addon.actions?.length ? (
        <div className="mt-4 space-y-2 w-full min-w-0">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Addon Actions</div>
          {addon.actions.map((ac) => (
            <div key={ac.action_id} className="flex items-center justify-between rounded-xl border bg-white p-2 gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{ac.label}</div>
                <div className="text-xs text-gray-500 truncate">
                  {ac.scope} • {ac.method} {ac.path}
                </div>
              </div>
              <div className="text-xs text-gray-500 shrink-0">
                {ac.is_enabled ? "enabled" : "disabled"}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )}
</Card>
  );
}
