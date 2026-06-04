import { useCatalog } from "../../data/useCatalog";

function clsForClassification(code: string) {
  switch (code) {
    case "benign":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";

    case "suspicious":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";

    case "malicious":
      return "border-red-300 bg-red-100 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";

    case "unknown":
      return "border-border bg-muted text-muted-foreground";

    default:
      return "border-border bg-muted text-foreground dark:text-muted-foreground";
  }
}

export default function ClassificationBadge({
  value,
}: {
  value?: string | null;
}) {
  const { catalog } = useCatalog();
  const code = (value || "unknown").toLowerCase();
  const label = catalog?.byClassificationCode?.[code] ?? code;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${clsForClassification(
        code
      )}`}
    >
      {label}
    </span>
  );
}