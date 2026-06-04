import { listSeverities, listClassifications, type SeverityItem, type ClassificationItem } from "../api/dataModels";

type Catalog = {
  severities: SeverityItem[];
  classifications: ClassificationItem[];
  bySeverityCode: Record<string, string>;
  byClassificationCode: Record<string, string>;
};

let cached: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;

function build(severities: SeverityItem[], classifications: ClassificationItem[]): Catalog {
  const s = severities.filter(x => x.is_active);
  const c = classifications.filter(x => x.is_active);

  return {
    severities: s,
    classifications: c,
    bySeverityCode: Object.fromEntries(s.map(x => [x.code, x.label])),
    byClassificationCode: Object.fromEntries(c.map(x => [x.code, x.label])),
  };
}

export async function getCatalog(): Promise<Catalog> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = Promise.all([
    listSeverities(false),
    listClassifications(false),
  ]).then(([s, c]) => {
    cached = build(s, c);
    inflight = null;
    return cached;
  }).catch((e) => {
    inflight = null;
    throw e;
  });

  return inflight;
}

export function clearCatalogCache() {
  cached = null;
}
