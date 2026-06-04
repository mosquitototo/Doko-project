const styles: Record<string, string> = {
  true_positive_with_impact:
    "border-red-300 bg-red-100 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",

  true_positive_without_impact:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",

  false_positive_technical:
    "border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300",

  false_positive:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",

  legitimate:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",

  unknown: "border-border bg-muted text-muted-foreground",

  not_applicable: "border-border bg-muted text-muted-foreground",
};

const labels: Record<string, string> = {
  true_positive_with_impact: "TP with impact",
  true_positive_without_impact: "TP no impact",
  false_positive_technical: "FP technical",
  false_positive: "False positive",
  legitimate: "Legitimate",
  unknown: "Unknown",
  not_applicable: "Not applicable",
};

export default function OutcomeBadge({ value }: { value?: string }) {
  const v = (value || "unknown").trim();
  const cls = styles[v] ?? "border-border bg-muted text-muted-foreground";
  const label = labels[v] ?? v;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}