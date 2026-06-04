const STORAGE_KEY = "doko_client_tab_id";

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getClientTabId(): string {
  const current = sessionStorage.getItem(STORAGE_KEY);
  if (current) return current;
  const value = makeId();
  sessionStorage.setItem(STORAGE_KEY, value);
  return value;
}

export function makeRequestId(): string {
  return makeId();
}