import { useState } from "react";
import { createPortal } from "react-dom";

export default function MergeDialog({
  open,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (caseId: string) => void;
  busy?: boolean;
}) {
  const [caseId, setCaseId] = useState("");

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 m-0 appearance-none rounded-none border-0 bg-black/30 p-0 outline-none backdrop-blur-[3px]"
        onClick={() => !busy && onCancel()}
        aria-label="Close merge dialog"
      />

      <div
        className="relative w-full max-w-md rounded-[28px] border border-border bg-card/95 p-5 shadow-panel backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold text-foreground">Merge into case</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Enter the Case ID to link this alert to an existing case.
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Case ID
          </label>
          <input
            className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-xl border border-border bg-background px-4 py-2 text-sm text-foreground transition hover:bg-accent disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800 disabled:opacity-50"
            onClick={() => onConfirm(caseId.trim())}
            disabled={busy || !caseId.trim()}
            type="button"
          >
            Merge
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}