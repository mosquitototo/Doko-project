export function resolveMediaUrl(
  value: string,
  pageOrigin = typeof window === "undefined" ? "" : window.location.origin,
  apiBaseUrl = import.meta.env.VITE_API_URL || "",
): string {
  if (!value || !pageOrigin) return value;
  try {
    const target = new URL(apiBaseUrl || pageOrigin, pageOrigin);
    const url = new URL(value, target.origin);
    if (
      !/^https?:$/.test(url.protocol) ||
      !/^https?:$/.test(target.protocol) ||
      !/^\/media\/(avatars|attachments|reports)\//.test(url.pathname) ||
      url.host !== target.host ||
      url.username || url.password
    ) return value;

    if (url.protocol === "http:" && target.protocol === "https:") {
      url.protocol = "https:";
      return url.href;
    }
    if (value.startsWith("/") && !value.startsWith("//") && target.origin !== pageOrigin) {
      return url.href;
    }
    return value;
  } catch {
    return value;
  }
}
