import type { EnrichmentLite } from "./types";

export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function richTextToPlainText(value: string) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " image ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/[#>*_~|[\]()`-]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}


export function isRichTextEmpty(html: string) {
  return richTextToPlainText(html) === "";
}

export function safeJsonStringify(x: any) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x ?? "");
  }
}

export const statusOptions = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export const outcomeOptions = [
  { value: "unknown", label: "Unknown" },
  { value: "true_positive_with_impact", label: "TP with impact" },
  { value: "true_positive_without_impact", label: "TP no impact" },
  { value: "false_positive_technical", label: "FP Technical" },
  { value: "false_positive", label: "False positive" },
  { value: "legitimate", label: "Legitimate" },
  { value: "not_applicable", label: "Not applicable" },
];

export const IOC_STATUS_OPTIONS = [
  { value: "observed", label: "Observed" },
  { value: "suspicious", label: "Suspicious" },
  { value: "malicious", label: "Malicious" },
  { value: "legitimate", label: "Legitimate" },
  { value: "unknown", label: "Unknown" },
  { value: "to_check", label: "To check" },
];

export const ASSET_STATUS_OPTIONS = [
  { value: "compromised", label: "Compromised" },
  { value: "not_compromised", label: "Not compromised" },
  { value: "unknown", label: "Unknown" },
  { value: "to_check", label: "To check" },
  { value: "observed", label: "Observed" },
  { value: "not_applicable", label: "N/A" },
];

export function rowId(k: string, v: string) {
  return `${String(k ?? "").trim()}::${String(v ?? "").trim()}`;
}

export function getHistoryBundle(
  history: Record<string, EnrichmentLite[]>,
  k: string,
  v: string,
  fallbackKeys: string[] = []
) {
  const kk = String(k ?? "").trim();
  const vv = String(v ?? "").trim();

  const candidates = [
    rowId(kk, vv),
    ...fallbackKeys.map((fk) => rowId(String(fk ?? "").trim(), vv)),
    rowId("", vv),
  ];

  const byId = new Map<string, EnrichmentLite>();
  for (const cid of candidates) {
    const arr = history[cid] || [];
    for (const a of arr) {
      const aid = String(a?.id ?? "");
      if (!aid) continue;
      if (!byId.has(aid)) byId.set(aid, a);
    }
  }

  const actions = Array.from(byId.values()).sort((a, b) => {
    const da = Date.parse(String(a?.created_at ?? "")) || 0;
    const db = Date.parse(String(b?.created_at ?? "")) || 0;
    return db - da;
  });

  const canonical = candidates.find((cid) => (history[cid]?.length ?? 0) > 0) || candidates[0];
  return { id: canonical, actions, latest: actions[0] || null };
}

export function tryBuildGenericSummary(r: EnrichmentLite) {
  if (!r) return "";
  if (r.status === "error") return "Error";

  const payload = r.response_payload;
  const msg = payload?.message ?? payload?.detail ?? payload?.data?.message ?? payload?.data?.detail ?? null;
  if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 120);

  return "no error";
}

export function flattenForTable(input: any): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const seen = new Set<any>();

  const push = (k: string, v: any) => {
    const value =
      v === null || v === undefined
        ? ""
        : typeof v === "string"
          ? v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : Array.isArray(v)
              ? `Array(${v.length})`
              : typeof v === "object"
                ? "Object"
                : String(v);
    out.push({ key: k, value });
  };

  const walk = (obj: any, prefix: string, depth: number) => {
    if (depth > 3) {
      push(prefix || "value", "[max depth]");
      return;
    }
    if (obj === null || obj === undefined) {
      push(prefix || "value", obj);
      return;
    }
    if (typeof obj !== "object") {
      push(prefix || "value", obj);
      return;
    }
    if (seen.has(obj)) {
      push(prefix || "value", "[circular]");
      return;
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        push(prefix || "array", "[]");
      } else {
        const take = obj.slice(0, 6);
        take.forEach((it, idx) => walk(it, `${prefix}[${idx}]`, depth + 1));
        if (obj.length > take.length) push(prefix, `… +${obj.length - take.length} more`);
      }
      return;
    }

    const entries = Object.entries(obj);
    if (entries.length === 0) {
      push(prefix || "object", "{}");
      return;
    }

    const take = entries.slice(0, 30);
    for (const [k, v] of take) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "object" && v !== null) {
        walk(v, p, depth + 1);
      } else {
        push(p, v);
      }
    }
    if (entries.length > take.length) push(prefix || "object", `… +${entries.length - take.length} more keys`);
  };

  walk(input, "", 0);
  return out.slice(0, 60);
}

export function sortByCreatedDesc(results: any[]) {
  const copy = Array.isArray(results) ? results.slice() : [];
  copy.sort((a, b) => {
    const da = Date.parse(String(a?.created_at ?? "")) || 0;
    const db = Date.parse(String(b?.created_at ?? "")) || 0;
    return db - da;
  });
  return copy;
}

export function normalizeResult(r: any): EnrichmentLite {
  const lite: EnrichmentLite = {
    id: String(r?.id ?? ""),
    status: r?.status === "error" ? "error" : "success",
    created_at: String(r?.created_at ?? ""),
    addon_id: r?.addon_id,
    action_id: r?.action_id,
    target_key: String(r?.target_key ?? ""),
    target_value: String(r?.target_value ?? ""),
    response_payload: r?.response_payload,
    error: r?.error,
  };
  lite.summary = tryBuildGenericSummary(lite);
  return lite;
}

export function buildHistoryIndex(results: any[]) {
  const out: Record<string, EnrichmentLite[]> = {};
  const sorted = sortByCreatedDesc(results ?? []);
  for (const r of sorted) {
    const k = String(r?.target_key ?? "");
    const v = String(r?.target_value ?? "");
    const id2 = rowId(k, v);
    const lite = normalizeResult(r);
    if (!out[id2]) out[id2] = [];
    out[id2].push(lite);
  }
  return out;
}

export function normalizeSubjectForReply(s: string) {
  const t = String(s || "").trim();
  if (!t) return "";
  if (/^\s*re\s*:/i.test(t)) return t;
  return `Re: ${t}`;
}

export function uniqKeepOrder(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const v = String(s || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export function parseCsv(s: string) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function joinCsv(arr: any) {
  return Array.isArray(arr) ? arr.join(", ") : "";
}
