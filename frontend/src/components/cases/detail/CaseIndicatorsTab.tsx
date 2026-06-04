import Card from "../../ui/Card";
import KeyValueEditor from "../../ui/KeyValueEditor";
import ConfirmDialog from "../../ui/ConfirmDialog";
import { ClearButton, RefreshButton } from "../../ui/IconButton";
import { useMemo, useState } from "react";
import { updateTicket } from "../../../api/cases";
import type { EventDetail } from "../../../api/caseDetail";
import type { EnrichmentLite, KVRow } from "./types";
import {
  ASSET_STATUS_OPTIONS,
  flattenForTable,
  formatDate,
  getHistoryBundle,
  IOC_STATUS_OPTIONS,
  rowId,
  safeJsonStringify,
} from "./utils";


type Props = {
  tab: "iocs" | "assets" | string;
  ticketId: string;
  event: EventDetail;
  iocs: KVRow[];
  assets: KVRow[];
  busy: boolean;
  canUpdateCase: boolean;
  push: (toast: { kind: "success" | "error" | "info"; title: string; message?: string }) => void;
  refreshAll: () => Promise<void>;
  refreshIocHistory: () => Promise<void>;
  refreshAssetHistory: () => Promise<void>;
  iocResultsBusy: boolean;
  assetResultsBusy: boolean;
  iocHistory: Record<string, EnrichmentLite[]>;
  assetHistory: Record<string, EnrichmentLite[]>;
  selectedIocKeys: Record<string, boolean>;
  setSelectedIocKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedAssetKeys: Record<string, boolean>;
  setSelectedAssetKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectMode: null | "ioc" | "asset";
  setSelectMode: React.Dispatch<React.SetStateAction<null | "ioc" | "asset">>;
  lastRunModeRef: React.MutableRefObject<"ioc" | "asset" | null>;
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  instancesBusy: boolean;
  openHistoryDrawer: (mode: "ioc" | "asset", k: string, v: string) => void;
  actionRaw: Record<string, boolean>;
  setActionRaw: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setEvent: React.Dispatch<React.SetStateAction<EventDetail | null>>;
};

function SelectionBar(props: {
  label: string;
  mode: "ioc" | "asset";
  busy: boolean;
  canUpdateCase: boolean;
  instancesBusy: boolean;
  selectMode: null | "ioc" | "asset";
  setSelectMode: React.Dispatch<React.SetStateAction<null | "ioc" | "asset">>;
  selectedKeys: Record<string, boolean>;
  onSelectedKeysChange: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  lastRunModeRef: React.MutableRefObject<"ioc" | "asset" | null>;
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onDelete: () => void;
  onSetStatus: (nextStatus: string) => void;
  statusOptions: { value: string; label: string }[];
}) {
  const count = useMemo(
    () => Object.values(props.selectedKeys).filter(Boolean).length,
    [props.selectedKeys]
  );
  const active = props.selectMode === props.mode || count > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/50 px-4 py-3">
      <div className="flex items-center gap-3">
        {active ? (
          <div className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {count} {props.label} selected
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Select rows to run connector actions
          </div>
        )}
      </div>

      {active ? (
        <div className="flex items-center gap-2">
          <ClearButton
            onClick={() => {
              props.onSelectedKeysChange({});
              if (props.selectMode === props.mode) {
                props.setSelectMode(null);
              }
            }}
            disabled={props.busy || count === 0}
            title="Clear selection"
          />

          <select
            className="h-9 rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
            disabled={props.busy || !props.canUpdateCase || count === 0}
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              props.onSetStatus(value);
              e.currentTarget.value = "";
            }}
          >
            <option value="">Set status…</option>
            {props.statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
            onClick={() => {
              props.lastRunModeRef.current = props.mode;
              props.setSelectMode(props.mode);
              props.setDrawerOpen(true);
            }}
            disabled={props.busy || count === 0 || props.instancesBusy}
          >
            Run ({count})
          </button>

          <button
            type="button"
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
            onClick={props.onDelete}
            disabled={props.busy || !props.canUpdateCase || count === 0}
          >
            Delete ({count})
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActionDetails(props: {
  action: EnrichmentLite;
  actionRaw: Record<string, boolean>;
  setActionRaw: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const aid = String(props.action.id || "");
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
          <div className="max-h-[360px] overflow-auto rounded-2xl border border-border bg-background">
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
                    <td className="p-3 text-muted-foreground" colSpan={2}>No data</td>
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
        </div>
      )}
    </div>
  );
}

export default function CaseIndicatorsTab(props: Props) {
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  if (props.tab !== "iocs" && props.tab !== "assets") return null;

  const isIoc = props.tab === "iocs";
  const rows = isIoc ? props.iocs : props.assets;
  const history = isIoc ? props.iocHistory : props.assetHistory;
  const selectedKeys = isIoc ? props.selectedIocKeys : props.selectedAssetKeys;
  const setSelectedKeys = isIoc ? props.setSelectedIocKeys : props.setSelectedAssetKeys;
  const refreshHistory = isIoc ? props.refreshIocHistory : props.refreshAssetHistory;
  const refreshBusy = isIoc ? props.iocResultsBusy : props.assetResultsBusy;
  const statusOptions = isIoc ? IOC_STATUS_OPTIONS : ASSET_STATUS_OPTIONS;
  const title = isIoc ? "IoCs" : "Assets";
  const subtitle = isIoc
    ? "Indicators of compromise tracked in this case"
    : "Hosts, users and other assets involved in this case";

  const selectedIds = useMemo(
    () => Object.keys(selectedKeys || {}).filter((k) => !!selectedKeys?.[k]),
    [selectedKeys]
  );


  function getIndicatorRowId(row: any) {
    const k = String(row?.field ?? row?.key ?? "").trim();
    const v = String(row?.value ?? "").trim();
    return rowId(k, v);
  }


  function buildRowsWithBulkStatus(nextStatus: string) {
    const picked = new Set(selectedIds);

    return (rows || []).map((row) => {
      const id = getIndicatorRowId(row);

      if (!picked.has(id)) return row;
      return { ...row, status: nextStatus };
    });
  }

  function buildRowsAfterBulkDelete() {
    const picked = new Set(selectedIds);

    return (rows || []).filter((row) => {
      const id = getIndicatorRowId(row);

      return !picked.has(id);
    });
  }

  async function saveBulkRows(nextRows: KVRow[], successTitle: string) {
    if (!props.canUpdateCase) return;
    props.setBusy(true);
    try {
      await updateTicket(props.ticketId, {
        [isIoc ? "iocs" : "assets"]: nextRows,
      } as any);

      props.setEvent((prev) =>
        prev
          ? ({ ...(prev as any), [isIoc ? "iocs" : "assets"]: nextRows } as any)
          : prev
      );

      props.push({ kind: "success", title: successTitle });
      setSelectedKeys({});
      await props.refreshAll();
      await refreshHistory();
    } catch (e: any) {
      props.push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      props.setBusy(false);
    }
  }

  function openGlobalHistory() {
    props.openHistoryDrawer(isIoc ? "ioc" : "asset", "", "");
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>

          <RefreshButton onClick={() => void refreshHistory()} disabled={refreshBusy || props.busy} title="Refresh results">
            {refreshBusy ? "Refreshing…" : "Refresh"}
          </RefreshButton>
        </div>

        <div className="mb-4">
          <SelectionBar
            label={title}
            mode={isIoc ? "ioc" : "asset"}
            busy={props.busy}
            canUpdateCase={props.canUpdateCase}
            instancesBusy={props.instancesBusy}
            selectMode={props.selectMode}
            setSelectMode={props.setSelectMode}
            selectedKeys={selectedKeys}
            onSelectedKeysChange={setSelectedKeys}
            lastRunModeRef={props.lastRunModeRef}
            setDrawerOpen={props.setDrawerOpen}
            onDelete={() => setConfirmBulkDelete(true)}
            onSetStatus={(nextStatus) => {
              void saveBulkRows(buildRowsWithBulkStatus(nextStatus), `${title} updated`);
            }}
            statusOptions={statusOptions}
          />
        </div>

        <KeyValueEditor
          title={`${title} list`}
          rows={rows || []}
          disabled={props.busy || !props.canUpdateCase}
          headerExtrasLabel="Connectors"
          showStatus={true}
          statusOptions={statusOptions}
          selectable={true}
          selectedKeys={selectedKeys}
          onSelectedKeysChange={setSelectedKeys}
          enableCsvActions={true}
          csvFilename={isIoc ? "case-iocs.csv" : "case-assets.csv"}
          headerActions={
            <button
              type="button"
              className="rounded-xl cursor-pointer border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
              onClick={openGlobalHistory}
              disabled={props.busy}
              title={`Open ${isIoc ? "IoC" : "asset"} history`}
            >
              History
            </button>
          }
          onImportSuccess={(count) =>
            props.push({
              kind: "success",
              title: "CSV imported",
              message: `${count} row${count > 1 ? "s" : ""} processed`,
            })
          }
          getRowId={(row) => getIndicatorRowId(row)}
          renderRowExtras={(row) => {
            const k = String((row as any)?.field ?? (row as any)?.key ?? "").trim();
            const v = String((row as any)?.value ?? "").trim();
            const bundle = getHistoryBundle(history, k, v, isIoc && !k ? ["ip"] : []);
            const hid = getIndicatorRowId(row);
            const latest = bundle.latest;

            return (
              <>
                {latest ? (
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      latest.status === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                    }`}
                    title={`${latest.summary || ""} • ${formatDate(latest.created_at)}`}
                  >
                    {latest.status === "success" ? "OK" : "Error"}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    No action
                  </span>
                )}

                {latest ? (
                  <span className="max-w-[220px] truncate text-[11px] text-muted-foreground">
                    {latest.summary || "—"}
                  </span>
                ) : null}

                <button
                  className="rounded-xl cursor-pointer border border-border bg-card px-3 py-2 text-xs text-foreground transition hover:bg-accent disabled:opacity-50"
                  onClick={() => {
                    props.lastRunModeRef.current = isIoc ? "ioc" : "asset";
                    if (isIoc) {
                      props.setSelectedIocKeys({ [hid]: true });
                      props.setSelectedAssetKeys({});
                    } else {
                      props.setSelectedAssetKeys({ [hid]: true });
                      props.setSelectedIocKeys({});
                    }
                    props.setSelectMode(isIoc ? "ioc" : "asset");
                    props.setDrawerOpen(true);
                  }}
                  disabled={props.busy || props.instancesBusy}
                  title="Run connector actions"
                >
                  Run
                </button>
              </>
            );
          }}
          onChange={async (next) => {
            if (!props.canUpdateCase) return;
            props.setBusy(true);
            try {
              await updateTicket(props.ticketId, { [isIoc ? "iocs" : "assets"]: next } as any);
              props.setEvent((prev) =>
                prev ? ({ ...(prev as any), [isIoc ? "iocs" : "assets"]: next } as any) : prev
              );
              props.push({ kind: "success", title: `${title} updated` });
              await props.refreshAll();
              await refreshHistory();
            } catch (e: any) {
              props.push({ kind: "error", title: "Error", message: String(e?.response?.status ?? "network") });
            } finally {
              props.setBusy(false);
            }
          }}
        />
      </Card>

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Confirm"
        message={`Delete ${selectedIds.length} ${isIoc ? "IoC" : "asset"}(s) ?`}
        confirmText="Delete"
        confirmTag="delete"
        cancelText="Cancel"
        cancelTag="cancel"
        onCancel={() => {
          if (props.busy) return;
          setConfirmBulkDelete(false);
        }}
        onConfirm={async () => {
          if (props.busy || !props.canUpdateCase) return;
          setConfirmBulkDelete(false);
          await saveBulkRows(buildRowsAfterBulkDelete(), `${title} updated`);
        }}
      />
    </div>
  );
}