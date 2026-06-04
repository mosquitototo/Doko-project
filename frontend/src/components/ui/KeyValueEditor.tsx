import React, { useEffect, useMemo, useRef, useState } from "react";
import { DeleteButton, NewGenButton } from "../../components/ui/IconButton";
import ConfirmDialog from "../ui/ConfirmDialog";

type Row = { field?: string; value?: string; type?: string; status?: string };
export type Normalized = { field: string; value: string; status?: string };

function normalize(rows: Row[]): Normalized[] {
  return (rows || []).map((r) => ({
    field: String((r as any).field ?? (r as any).type ?? ""),
    value: String((r as any).value ?? ""),
    status: String((r as any).status ?? ""),
  }));
}

function normalizeKey(field: string, value: string) {
  return `${field.trim().toLowerCase()}::${value.trim().toLowerCase()}`;
}

function escapeCsvCell(value: string) {
  const v = String(value ?? "");
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildCsv(rows: Normalized[]) {
  const lines = ["field,value"];
  for (const row of rows) {
    const field = String(row.field ?? "").trim();
    const value = String(row.value ?? "").trim();
    if (!field && !value) continue;
    lines.push(`${escapeCsvCell(field)},${escapeCsvCell(value)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === `"`) {
        if (line[i + 1] === `"`) {
          current += `"`;
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === `"`) {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      out.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  out.push(current);
  return out;
}

function parseCsvText(text: string): Normalized[] {
  const clean = String(text ?? "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((x) => x.trim().toLowerCase());
  if (header.length < 2 || header[0] !== "field" || header[1] !== "value") {
    throw new Error('Invalid CSV header. Expected exactly: field,value');
  }

  const out: Normalized[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const field = String(cols[0] ?? "").trim();
    const value = String(cols[1] ?? "").trim();
    if (!field && !value) continue;
    out.push({ field, value, status: "" });
  }

  if (out.length > 5000) {
    throw new Error("Too many rows in CSV. Maximum is 5000.");
  }

  return out;
}

function InlineInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-8 w-full rounded-xl border border-transparent bg-transparent px-2.5 text-[13px] text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "hover:border-border hover:bg-background/70",
        "focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

function InlineSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "h-8 w-full rounded-xl border border-transparent bg-transparent px-2.5 text-[12px] text-foreground outline-none transition",
        "hover:border-border hover:bg-background/70",
        "focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

export default function KeyValueEditor({
  title,
  rows,
  onChange,
  disabled,
  renderRowExtras,
  headerExtrasLabel = "Extras",
  showStatus = false,
  statusOptions = [],
  selectable = false,
  getRowId,
  selectedKeys,
  onSelectedKeysChange,
  enableCsvActions = false,
  csvFilename,
  onImportSuccess,
  scrollBodyClassName,
  headerActions,
  confirmDeleteTitle,
  confirmDeleteMessage,
}: {
  title: string;
  rows: Row[];
  onChange: (next: Normalized[]) => Promise<void>;
  disabled?: boolean;
  renderRowExtras?: (row: Normalized, index: number) => React.ReactNode;
  headerExtrasLabel?: string;
  showStatus?: boolean;
  statusOptions?: { value: string; label: string }[];
  selectable?: boolean;
  getRowId?: (row: Normalized, index: number) => string;
  selectedKeys?: Record<string, boolean>;
  onSelectedKeysChange?: (next: Record<string, boolean>) => void;
  enableCsvActions?: boolean;
  csvFilename?: string;
  onImportSuccess?: (count: number) => void;
  scrollBodyClassName?: string;
  headerActions?: React.ReactNode;
  confirmDeleteTitle?: string;
  confirmDeleteMessage?: (row: Normalized, index: number) => React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Normalized[]>(() => normalize(rows));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  useEffect(() => {
    setLocal(normalize(rows));
  }, [JSON.stringify(rows)]);

  function sanitize(next: Normalized[]) {
    return next
      .map((x) => ({
        field: x.field.trim(),
        value: x.value.trim(),
        status: (x.status ?? "").trim(),
      }))
      .filter((x) => x.field || x.value || x.status);
  }

  function setRow(i: number, patch: Partial<Normalized>) {
    setLocal((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function save(next: Normalized[]) {
    setBusy(true);
    try {
      await onChange(sanitize(next));
    } finally {
      setBusy(false);
    }
  }

  async function saveIfRowDirty(index: number, originalRows: Row[]) {
    const original = normalize(originalRows);
    const current = local[index];
    const previous = original[index];

    const currentField = (current?.field ?? "").trim();
    const currentValue = (current?.value ?? "").trim();
    const currentStatus = (current?.status ?? "").trim();

    const previousField = (previous?.field ?? "").trim();
    const previousValue = (previous?.value ?? "").trim();
    const previousStatus = (previous?.status ?? "").trim();

    if (
      currentField === previousField &&
      currentValue === previousValue &&
      currentStatus === previousStatus
    ) {
      return;
    }

    await save(local);
  }

  async function handleImportFile(file: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("CSV too large. Maximum size is 2 MB.");
    }

    const text = await file.text();
    const imported = parseCsvText(text);
    const current = sanitize(local);

    const merged = [...current];
    const seen = new Set(current.map((row) => normalizeKey(row.field, row.value)));

    for (const row of imported) {
      const key = normalizeKey(row.field, row.value);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ field: row.field, value: row.value, status: "" });
    }

    setLocal(merged);
    await save(merged);
    onImportSuccess?.(imported.length);
  }

  function handleExport() {
    const csv = buildCsv(sanitize(local));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename || `${title.toLowerCase().replace(/\s+/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const hasExtras = typeof renderRowExtras === "function";
  const hasSelection =
    !!selectable &&
    typeof getRowId === "function" &&
    !!selectedKeys &&
    typeof onSelectedKeysChange === "function";

  const rowIds = useMemo(() => {
    if (!hasSelection) return [];
    return local.map((r, i) => {
      try {
        const id = String(getRowId!(r, i) || "");
        return id || `row-${i}`;
      } catch {
        return `row-${i}`;
      }
    });
  }, [hasSelection, local, getRowId]);

  const allSelected = useMemo(() => {
    if (!hasSelection || rowIds.length === 0) return false;
    return rowIds.every((id) => !!selectedKeys![id]);
  }, [hasSelection, rowIds, selectedKeys]);

  const someSelected = useMemo(() => {
    if (!hasSelection || rowIds.length === 0) return false;
    const any = rowIds.some((id) => !!selectedKeys![id]);
    return any && !allSelected;
  }, [hasSelection, rowIds, selectedKeys, allSelected]);

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!hasSelection || !headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = someSelected;
  }, [hasSelection, someSelected]);

  function toggleOne(id: string) {
    if (!hasSelection) return;
    onSelectedKeysChange!({
      ...selectedKeys!,
      [id]: !selectedKeys![id],
    });
  }

  function toggleAll(nextChecked: boolean) {
    if (!hasSelection) return;
    const next = { ...selectedKeys! };
    for (const id of rowIds) next[id] = nextChecked;
    onSelectedKeysChange!(next);
  }

  const headerGridClass = hasSelection
    ? hasExtras && showStatus
      ? "grid-cols-[28px_minmax(0,2fr)_minmax(0,3.2fr)_minmax(130px,1.2fr)_minmax(0,1.6fr)_92px]"
      : hasExtras
        ? "grid-cols-[28px_minmax(0,2fr)_minmax(0,3.2fr)_minmax(0,1.6fr)_92px]"
        : showStatus
          ? "grid-cols-[28px_minmax(0,2fr)_minmax(0,3.2fr)_minmax(130px,1.2fr)_92px]"
          : "grid-cols-[28px_minmax(0,2fr)_minmax(0,3.2fr)_92px]"
    : hasExtras && showStatus
      ? "grid-cols-[minmax(0,2fr)_minmax(0,3.2fr)_minmax(130px,1.2fr)_minmax(0,1.6fr)_92px]"
      : hasExtras
        ? "grid-cols-[minmax(0,2fr)_minmax(0,3.2fr)_minmax(0,1.6fr)_92px]"
        : showStatus
          ? "grid-cols-[minmax(0,2fr)_minmax(0,3.2fr)_minmax(130px,1.2fr)_92px]"
          : "grid-cols-[minmax(0,2fr)_minmax(0,3.2fr)_92px]";

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          try {
            await handleImportFile(file);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unable to import CSV";
            window.alert(message);
          }
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">
            {local.length} row{local.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {headerActions}

          {enableCsvActions ? (
            <>
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl cursor-pointer border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                title="Import CSV"
              >
                Import CSV
              </button>
              <button
                type="button"
                disabled={disabled || busy || sanitize(local).length === 0}
                onClick={handleExport}
                className="rounded-xl border cursor-pointer border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                title="Export CSV"
              >
                Export CSV
              </button>
            </>
          ) : null}

          {busy ? <div className="text-xs text-muted-foreground">Saving…</div> : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className={`grid ${headerGridClass} gap-3 border-b border-border bg-background/70 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground`}>
          {hasSelection ? (
            <div className="flex items-center justify-center">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
                disabled={disabled || busy}
                title="Select all"
                className="h-3.5 w-3.5"
              />
            </div>
          ) : null}

          <div>Field</div>
          <div>Value</div>
          {showStatus ? <div>Status</div> : null}
          {hasExtras ? <div>{headerExtrasLabel}</div> : null}
          <div className="text-right">Actions</div>
        </div>


        <div className={scrollBodyClassName ? `overflow-y-auto ${scrollBodyClassName}` : ""}>
          {local.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-sm font-medium text-foreground">Empty</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Add rows to start filling this section.
              </div>
            </div>
          ) : (
            local.map((r, i) => {
              const id = hasSelection ? rowIds[i] : "";
              const checked = hasSelection ? !!selectedKeys![id] : false;

              return (
                <div key={i} className="border-b border-border last:border-b-0 px-4 py-2.5 transition hover:bg-accent/20">
                  <div className={`grid ${headerGridClass} items-center gap-3`}>
                    {hasSelection ? (
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(id)}
                          disabled={disabled || busy}
                          title="Select"
                          className="h-3.5 w-3.5"
                        />
                      </div>
                    ) : null}

                    <InlineInput
                      value={r.field}
                      placeholder="ex: ip, domain, hash..."
                      disabled={disabled || busy}
                      onChange={(e) => setRow(i, { field: e.target.value })}
                      onBlur={() => {
                        void saveIfRowDirty(i, rows);
                      }}
                    />

                    <InlineInput
                      value={r.value}
                      placeholder="value…"
                      disabled={disabled || busy}
                      onChange={(e) => setRow(i, { value: e.target.value })}
                      onBlur={() => {
                        void saveIfRowDirty(i, rows);
                      }}
                    />

                    {showStatus ? (
                      <InlineSelect
                        value={r.status ?? ""}
                        disabled={disabled || busy}
                        onChange={(e) => {
                          const next = e.target.value;
                          setRow(i, { status: next });
                          const updated = local.map((x, idx) => (idx === i ? { ...x, status: next } : x));
                          void save(updated);
                        }}
                        onBlur={() => {
                          void saveIfRowDirty(i, rows);
                        }}
                      >
                        <option value="">—</option>
                        {statusOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </InlineSelect>
                    ) : null}

                    {hasExtras ? (
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          {renderRowExtras?.(r, i)}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex justify-end gap-1.5">
                      <DeleteButton
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => {
                          setConfirmDeleteIndex(i);
                        }}
                        title="Delete row"
                        className="scale-90"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <NewGenButton
          type="button"
          disabled={disabled || busy}
          onClick={async () => {
            const next = [...local, { field: "", value: "", status: "" }];
            setLocal(next);
            await save(next);
          }}
          title="Add row"
          className="scale-90"
        />
      </div>
      <ConfirmDialog
        open={confirmDeleteIndex !== null}
        title={confirmDeleteTitle || "Confirm"}
        message={
          confirmDeleteIndex !== null
            ? confirmDeleteMessage?.(local[confirmDeleteIndex], confirmDeleteIndex) ??
              "Delete this element ?"
            : ""
        }
        confirmText="Delete"
        confirmTag="delete"
        cancelText="Cancel"
        cancelTag="cancel"
        onCancel={() => {
          if (busy) return;
          setConfirmDeleteIndex(null);
        }}
        onConfirm={async () => {
          if (confirmDeleteIndex === null || busy) return;
          const idx = confirmDeleteIndex;
          setConfirmDeleteIndex(null);
          const next = local.filter((_, rowIndex) => rowIndex !== idx);
          setLocal(next);
          await save(next);
        }}
      />
    </div>
  );
}