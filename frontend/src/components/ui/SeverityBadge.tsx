import { useCatalog } from "../../data/useCatalog";
import { legacySeverityColor, severityColorClass } from "./severityColors";

export default function SeverityBadge({ value }: { value?: string | null }) {
  const { catalog } = useCatalog();

  const code = (value || "unknown").toLowerCase();
  const label = catalog?.bySeverityCode?.[code] ?? code;
  const color = catalog?.severityColorsByCode?.[value || ""] ?? catalog?.severityColorsByCode?.[code] ?? legacySeverityColor(code);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${severityColorClass(color)}`}
    >
      {label}
    </span>
  );
}
