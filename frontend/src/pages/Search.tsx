import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Card from "../components/ui/Card";
import { useUiAccess } from "../hooks/useUiAccess";
import { unifiedSearch, type SearchItem } from "../api/search";
import { Eraser, SearchButton, Search as SearchIcon } from "../components/ui/IconButton";

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function stripHtml(value?: string | null) {
  if (!value) return "";

  if (typeof window !== "undefined" && typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(value, "text/html");
      return (doc.body.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      return value
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function typeLabel(value: SearchItem["type"]) {
  switch (value) {
    case "case":
      return "Case";
    case "alert":
      return "Alert";
    case "hunt":
      return "Hunt";
    case "case_comment":
      return "Case comment";
    case "alert_comment":
      return "Alert comment";
    case "hunt_journal":
      return "Hunt journal";
    case "ioc":
      return "IoC";
    case "asset":
      return "Asset";
    default:
      return value;
  }
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { handlePassiveLoadError } = useUiAccess();
  const initial = params.get("q") || "";

  const [query, setQuery] = useState(initial);
  const [submittedQuery, setSubmittedQuery] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchItem[]>([]);

  useEffect(() => {
    const q = (submittedQuery || "").trim();
    if (q.length < 3) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    unifiedSearch(q)
      .then((res) => {
        if (cancelled) return;
        setResults(Array.isArray(res.results) ? res.results : []);
      })
      .catch((e) => {
        if (cancelled) return;

        handlePassiveLoadError(e, {
          onForbidden: () => {
            setResults([]);
          },
          setError,
          fallback: "Unable to run search.",
        });
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [submittedQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchItem[]>();
    for (const item of results) {
      const key = typeLabel(item.type);
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    }
    return Array.from(map.entries());
  }, [results]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    setParams(q ? { q } : {});
    setSubmittedQuery(q);
  };

  const onClear = () => {
    setQuery("");
    setSubmittedQuery("");
    setParams({});
    setResults([]);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Search
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Search across cases, alerts, hunts, comments, journal notes, IoCs and assets.
        </div>
      </div>

      <Card className="p-4">
        <form onSubmit={onSubmit} className="flex flex-col items-center gap-3 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a case, alert, hunt, comment, IOC, asset..."
              className="h-12 w-full rounded-2xl border border-border bg-background pl-10 pr-11 text-sm text-foreground outline-none transition focus:border-primary"
            />
            {query ? (
              <button
                type="button"
                title="Clear"
                onClick={onClear}
                className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border-none text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Eraser />
              </button>
            ) : null}
          </div>

          <SearchButton
            type="submit"
            className="inline-flex bg-primary text-primary-foreground"
          />
        </form>

        <div className="mt-3 text-xs text-muted-foreground">
          Minimum 3 characters.
        </div>
      </Card>

      {loading ? (
        <Card className="p-5 text-sm text-muted-foreground">Searching…</Card>
      ) : null}

      {error ? (
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">{error}</div>
        </Card>
      ) : null}

      {!loading && !error && submittedQuery.trim().length >= 3 && results.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          No result for “{submittedQuery}”.
        </Card>
      ) : null}

      <div className="space-y-4">
        {grouped.map(([groupName, items]) => (
          <div key={groupName} className="space-y-3">
            <div className="mb-1 mt-12 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {groupName} · {items.length}
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const cleanTitle = stripHtml(item.title);
                const cleanSnippet = stripHtml(item.snippet);

                return (
                  <Link key={`${item.type}-${item.id}`} to={item.url}>
                    <Card className="mb-4 p-4 transition hover:bg-accent/40">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                              {typeLabel(item.type)}
                            </span>
                            {item.customer_name ? (
                              <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {item.customer_name}
                              </span>
                            ) : null}
                          </div>

                          <div className="truncate text-base font-semibold text-foreground">
                            {cleanTitle || item.title}
                          </div>

                          {cleanSnippet ? (
                            <div className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                              {cleanSnippet}
                            </div>
                          ) : null}

                          {item.parent ? (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Linked to {item.parent.type} #{item.parent.id}
                            </div>
                          ) : null}
                        </div>

                        <div className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(item.updated_at)}
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}