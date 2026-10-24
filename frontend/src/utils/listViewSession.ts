const PREFIX = "doko:list-filters:";

export type ListFilters = {
  status?: string[];
  priority?: string[];
  owner?: string[];
  classification?: string[];
  severity?: string[];
  customer?: string[];
  outcome?: string[];
  searchInput?: string;
  createdFrom?: string;
  createdTo?: string;
  ordering?: string;
  includeArchived?: boolean;
  filtersOpen?: boolean;
};

function validatedFilters(value: unknown): ListFilters {
  const result: ListFilters = {};
  if (!value || typeof value !== "object") return result;
  const data = value as Record<string, unknown>;
  for (const key of ["status", "priority", "owner", "classification", "severity", "customer", "outcome"] as const) {
    const entry = data[key];
    if (Array.isArray(entry) && entry.every(item => typeof item === "string")) result[key] = entry;
  }
  for (const key of ["searchInput", "createdFrom", "createdTo", "ordering"] as const) {
    if (typeof data[key] === "string") result[key] = data[key];
  }
  for (const key of ["includeArchived", "filtersOpen"] as const) {
    if (typeof data[key] === "boolean") result[key] = data[key];
  }
  return result;
}

export function readListFilters(list: "alerts" | "cases" | "tasks", userId?: number): ListFilters {
  if (userId == null) return {};
  try {
    return validatedFilters(JSON.parse(sessionStorage.getItem(`${PREFIX}${userId}:${list}`) || "null"));
  } catch {
    return {};
  }
}

export function saveListFilters(list: "alerts" | "cases" | "tasks", userId: number | undefined, filters: ListFilters) {
  if (userId == null) return;
  try {
    sessionStorage.setItem(`${PREFIX}${userId}:${list}`, JSON.stringify(validatedFilters(filters)));
  } catch {}
}

export function clearListFilters() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {}
}
