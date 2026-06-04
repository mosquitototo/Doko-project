const styles: Record<string, string> = {
  open:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",

  to_do:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",

  in_progress:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",

  resolved:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",

  completed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",

  merged:
    "border-border bg-muted text-muted-foreground opacity-70",

  closed:
    "border-border bg-muted text-muted-foreground",

  archived:
    "border-border bg-muted text-muted-foreground opacity-70",

  canceled:
    "border-border bg-muted text-muted-foreground opacity-70",
};

const labels: Record<string, string> = {
  open: "Open",
  to_do: "To do",
  in_progress: "In progress",
  resolved: "Resolved",
  completed: "Completed",
  merged: "Merged",
  closed: "Closed",
  archived: "Archived",
  canceled: "Canceled",
};

export default function StatusBadge({ status }: { status: string }) {
  const cls = styles[status] ?? "border-border bg-muted text-muted-foreground";
  const label = labels[status] ?? status;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}