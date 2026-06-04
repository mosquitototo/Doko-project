import { createPortal } from "react-dom";
import { CancelButton } from "../../ui/IconButton";
import type { EnrichmentLite } from "./types";
import { flattenForTable, formatDate, safeJsonStringify } from "./utils";

type Props = {
  open: boolean;
  mode: "ioc" | "asset";
  k: string;
  v: string;
  actions: EnrichmentLite[];
  actionRaw: Record<string, boolean>;
  setActionRaw: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onClose: () => void;
};

function ActionDetails(props: {
  action: EnrichmentLite;
  actionRaw: Record<string, boolean>;
  setActionRaw: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  storageKey?: string;
}) {
  const aid = `${props.storageKey || String(props.action.id || "")}:raw`;
  const raw = !!props.actionRaw[aid];
  const tableRows = flattenForTable(props.action.response_payload);

  return (
    <div className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            Action {props.action.action_id ? String(props.action.action_id) : "—"} • {formatDate(props.action.created_at)}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {props.action.status === "error" ? "Error" : "Success"} • {props.action.summary || "—"}
          </div>
        </div>

        <button
          type="button"
          className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          onClick={() => props.setActionRaw((prev) => ({ ...prev, [aid]: !prev[aid] }))}
        >
          {raw ? "Parsed view" : "Raw JSON"}
        </button>
      </div>

      {props.action.status === "error" ? (
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-semibold">Error</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-xs">{String(props.action.error || "Unknown error")}</div>
        </div>
      ) : null}

      {raw ? (
        <pre className="mt-3 max-h-[360px] overflow-auto rounded-2xl border border-border bg-background p-3 text-[11px] leading-snug text-foreground">
          {safeJsonStringify(props.action.response_payload)}
        </pre>
      ) : (
        <div className="mt-3">
          <div className="max-h-[360px] overflow-auto rounded-md border border-border bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className="w-[45%] p-3 text-left font-semibold text-muted-foreground">Key</th>
                  <th className="p-3 text-left font-semibold text-muted-foreground">Value</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={2}>
                      No data
                    </td>
                  </tr>
                ) : (
                  tableRows.map((r, idx) => (
                    <tr key={`${r.key}-${idx}`} className="border-b border-border last:border-b-0">
                      <td className="p-3 align-top break-words text-foreground">{r.key}</td>
                      <td className="whitespace-pre-wrap break-words p-3 text-foreground">{r.value}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Parsed view is generic and flattened. Switch to Raw JSON for the full structure.
          </div>
        </div>
      )}
    </div>
  );
}

export default function CaseHistoryDrawer({ open, mode, k, v, actions, actionRaw, setActionRaw, onClose }: Props) {
  if (!open) return null;

  const label = mode === "ioc" ? "IoC" : "Asset";

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <button
        type="button"
        className="absolute inset-0 m-0 appearance-none rounded-none border-0 bg-black/40 p-0 outline-none backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close history"
      />

      <div className="absolute right-0 top-0 flex h-full w-full max-w-[760px] flex-col bg-card">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-foreground">{label} history</div>
              <div className="mt-1 break-words text-sm text-muted-foreground">
                {k ? <span className="mx-1 text-muted-foreground">•</span> : null}
                {k ? <span>{k}</span> : null}
              </div>
              <div className="mt-2 inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {actions.length} action{actions.length > 1 ? "s" : ""}
              </div>
            </div>
            <CancelButton title="Close history" onClick={onClose} />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-5">
          {actions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
              <div className="text-sm font-medium text-foreground">No action yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Connector history will appear here after runs.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {actions.map((a) => {
                const actionKey = `drawer-act:${a.id}`;
                const isOpen = !!actionRaw[actionKey];

                return (
                  <div key={a.id} className="overflow-hidden rounded-2xl border border-border bg-background/50">
                    <button
                      type="button"
                      className="flex w-full border-none bg-slate-800 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-accent/70"
                      onClick={() =>
                        setActionRaw((prev) => ({ ...prev, [actionKey]: !prev[actionKey] }))
                      }
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              a.status === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                            }`}
                          >
                            {a.status === "success" ? "OK" : "Error"}
                          </span>
                          <div className="truncate text-xs font-semibold text-foreground">
                            {a.action_id ? String(a.action_id) : "Action"} • {formatDate(a.created_at)}
                          </div>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">{a.summary || "—"}</div>
                      </div>

                      <div className="text-xs text-muted-foreground">{isOpen ? "▲" : "▼"}</div>
                    </button>

                    {isOpen ? (
                      <div className="px-4 pb-4">
                        <ActionDetails
                          action={a}
                          actionRaw={actionRaw}
                          setActionRaw={setActionRaw}
                          storageKey={actionKey}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
