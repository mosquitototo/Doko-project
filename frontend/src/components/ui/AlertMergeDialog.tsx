import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { fetchCasesLite, type CaseLite } from "../../api/casesLite";
import {
  MergeButton,
  CancelButton,
  NewGenButton,
} from "../../components/ui/IconButton";

type Mode = "new" | "existing";

function sortCases(cases: CaseLite[]) {
  const rank: Record<string, number> = {
    open: 0,
    in_progress: 1,
    resolved: 2,
    closed: 3,
  };

  return [...cases].sort((a, b) => {
    const ra = rank[a.status] ?? 99;
    const rb = rank[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
}

export default function AlertMergeDialog({
  open,
  onCancel,
  onConfirmNew,
  onConfirmExisting,
  busy,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirmNew: () => void;
  onConfirmExisting: (caseId: string) => void;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("new");
  const [q, setQ] = useState("");
  const [cases, setCases] = useState<CaseLite[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [loadingCases, setLoadingCases] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("new");
    setQ("");
    setSelectedCaseId("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoadingCases(true);

    fetchCasesLite(q.trim() || undefined)
      .then((data) => {
        if (!mounted) return;
        setCases(data);
      })
      .finally(() => mounted && setLoadingCases(false));

    return () => {
      mounted = false;
    };
  }, [open, q]);

  const sorted = useMemo(() => sortCases(cases), [cases]);

  if (!open) return null;

  type CaseItem = { id: string; title: string; status: string };

  function CaseCombo({
    label,
    items,
    selectedId,
    onChange,
    busy,
    loading,
    placeholder = "— Select a case —",
    searchPlaceholder = "type to filter…",
    hint,
  }: {
    label: string;
    items: CaseItem[];
    selectedId: string;
    onChange: (id: string) => void;
    busy?: boolean;
    loading?: boolean;
    placeholder?: string;
    searchPlaceholder?: string;
    hint?: React.ReactNode;
  }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const selected = useMemo(
      () => items.find((x) => x.id === selectedId) ?? null,
      [items, selectedId]
    );

    const filtered = useMemo(() => {
      const s = q.trim().toLowerCase();
      if (!s) return items;
      return items.filter((c) => {
        const t = `${c.status} ${c.title}`.toLowerCase();
        return t.includes(s);
      });
    }, [items, q]);

    useEffect(() => {
      function onDocDown(e: MouseEvent) {
        const el = wrapRef.current;
        if (!el) return;
        if (e.target instanceof Node && !el.contains(e.target)) {
          setOpen(false);
        }
      }

      document.addEventListener("mousedown", onDocDown);
      return () => document.removeEventListener("mousedown", onDocDown);
    }, []);

    useEffect(() => {
      if (open) {
        setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setQ("");
      }
    }, [open]);

    const disabled = !!busy || !!loading;

    return (
      <div ref={wrapRef} className="relative">
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">
          {label} {loading ? "(loading…)" : ""}
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-left text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
        >
          {selected ? `[${selected.status}] ${selected.title}` : placeholder}
        </button>

        {open ? (
          <div className="absolute z-50 mt-2 w-full rounded-2xl border border-border bg-card shadow-panel">
            <div className="p-2">
              <input
                ref={inputRef}
                className="w-full box-border rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                placeholder={searchPlaceholder}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                disabled={disabled}
              />
            </div>

            <div className="max-h-64 overflow-auto p-1">
              <button
                type="button"
                className="w-full rounded-xl border-none bg-transparent px-3 py-2 text-left text-sm text-foreground transition hover:bg-accent"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                disabled={disabled}
              >
                {placeholder}
              </button>

              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full rounded-xl border-none bg-transparent px-3 py-2 text-left text-sm text-foreground transition hover:bg-accent"
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                  disabled={disabled}
                  title={`${c.status} • ${c.title}`}
                >
                  [{c.status}] {c.title}
                </button>
              ))}

              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No match
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 m-0 appearance-none rounded-none border-0 bg-black/30 p-0 outline-none backdrop-blur-[3px]"
        onClick={() => !busy && onCancel()}
        aria-label="Close merge dialog"
      />

      <div
        className="relative w-full max-w-lg rounded-[28px] border border-border bg-card/95 p-5 shadow-panel backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold text-foreground">Merge alert</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Create a new case or attach the alert to an existing case.
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              disabled={busy}
            />
            Create new case (Escalate)
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={busy}
            />
            Merge into existing case
          </label>

          {mode === "existing" ? (
            <div className="mt-3 space-y-3 rounded-2xl p-3 outline-none">
              <CaseCombo
                label="Select case"
                items={sorted}
                selectedId={selectedCaseId}
                onChange={(id) => setSelectedCaseId(id)}
                busy={busy}
                loading={loadingCases}
                placeholder="— Select a case —"
                searchPlaceholder="type to filter…"
              />
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <CancelButton
            className="px-4 py-2"
            onClick={onCancel}
            disabled={busy}
          />
          {mode === "new" ? (
            <NewGenButton
              className="px-4 py-2"
              onClick={onConfirmNew}
              disabled={busy}
            />
          ) : (
            <MergeButton
              className="px-4 py-2"
              onClick={() => onConfirmExisting(selectedCaseId)}
              disabled={busy || !selectedCaseId}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}