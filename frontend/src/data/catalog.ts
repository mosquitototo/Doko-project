import { listSeverities, listClassifications, type SeverityItem, type ClassificationItem } from "../api/dataModels";
import { legacySeverityColor } from "../components/ui/severityColors";

type Catalog = {
  severities: SeverityItem[];
  classifications: ClassificationItem[];
  bySeverityCode: Record<string, string>;
  byClassificationCode: Record<string, string>;
  severityColorsByCode: Record<string, string>;
};

let cached: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;
export const CATALOG_CHANGED_EVENT = "doko:catalog-changed";

function build(severities: SeverityItem[], classifications: ClassificationItem[]): Catalog {
  const s = severities.filter(x => x.is_active);
  const c = classifications.filter(x => x.is_active);

  return {
    severities: s,
    classifications: c,
    bySeverityCode: Object.fromEntries(s.map(x => [x.code, x.label])),
    byClassificationCode: Object.fromEntries(c.map(x => [x.code, x.label])),
    severityColorsByCode: Object.fromEntries(severities.map(x => [x.code, x.color ?? legacySeverityColor(x.code)])),
  };
}

export async function getCatalog(): Promise<Catalog> {
  if (cached) return cached;
  if (inflight) return inflight;

  const request = Promise.all([
    listSeverities(true),
    listClassifications(false),
  ]).then(([s, c]) => {
    const result = build(s, c);
    if (inflight === request) {
      cached = result;
      inflight = null;
    }
    return result;
  }).catch((e) => {
    if (inflight === request) inflight = null;
    throw e;
  });

  inflight = request;
  return request;
}

export function clearCatalogCache() {
  cached = null;
  inflight = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
}
