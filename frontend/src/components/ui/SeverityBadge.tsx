import { useCatalog } from "../../data/useCatalog";

function clsForSeverity(code: string) {
  switch (code) {
    case "low":
      return "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300";

    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";

    case "high":
      return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300";

    case "critical":
      return "border-red-300 bg-red-100 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";

    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export default function SeverityBadge({ value }: { value?: string | null }) {
  const { catalog } = useCatalog();

  const code = (value || "unknown").toLowerCase();
  const label = catalog?.bySeverityCode?.[code] ?? code;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${clsForSeverity(
        code
      )}`}
    >
      {label}
    </span>
  );
}