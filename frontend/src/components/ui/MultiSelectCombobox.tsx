import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "../../components/ui/IconButton";


export type MultiSelectComboboxOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  options: MultiSelectComboboxOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  widthClass?: string;
  maxPreviewItems?: number;
};

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

export default function MultiSelectCombobox({
  label,
  options,
  value,
  onChange,
  placeholder = "-",
  searchPlaceholder,
  emptyMessage = "No matching option",
  disabled = false,
  widthClass = "w-full",
  maxPreviewItems = 2,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!open) return;
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(t);
  }, [open]);

  const selectedSet = useMemo(() => new Set(value || []), [value]);

  const selectedLabels = useMemo(() => {
    if (!value?.length) return [];
    const map = new Map(options.map((o) => [o.value, o.label]));
    return value.map((v) => map.get(v) ?? v);
  }, [value, options]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const displayText = useMemo(() => {
    if (!selectedLabels.length) return placeholder;
    if (selectedLabels.length <= maxPreviewItems) return selectedLabels.join(", ");
    return `${selectedLabels.slice(0, maxPreviewItems).join(", ")} +${
      selectedLabels.length - maxPreviewItems
    }`;
  }, [selectedLabels, placeholder, maxPreviewItems]);

  const titleText = selectedLabels.join(", ");

  const allSelected =
    options.length > 0 && value.length > 0 && value.length === options.length;

  function toggleValue(nextValue: string) {
    const set = new Set(value || []);
    if (set.has(nextValue)) set.delete(nextValue);
    else set.add(nextValue);
    onChange(Array.from(set));
  }

  function clearAll() {
    onChange([]);
  }

  function selectAll() {
    onChange(options.map((o) => o.value));
  }

  return (
    <div className={`${widthClass} min-w-0`} ref={rootRef}>
      <FilterLabel>{label}</FilterLabel>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 text-sm shadow-sm outline-none transition",
          "focus:border-ring focus:ring-2 focus:ring-ring/20",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "hover:border-ring/30 hover:bg-accent/70 hover:text-accent-foreground",
        ].join(" ")}
        title={titleText}
      >
        <span
          className={
            selectedLabels.length
              ? "truncate text-foreground"
              : "truncate text-muted-foreground"
          }
        >
          {displayText}
        </span>

        <div className="flex items-center gap-2">
          {selectedLabels.length > 0 ? (
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
              {selectedLabels.length}
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </button>

      {open && !disabled ? (
        <div className="relative">
          <div className="absolute left-0 z-[120] mt-2 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_50px_rgba(2,6,23,0.18)]">
            <div className="border-b border-border bg-card p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    searchPlaceholder ?? `Search ${label.toLowerCase()}...`
                  }
                  className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-8 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="rounded-lg px-2.5 py-1 text-[11px] border-none cursor-pointer bg-transparent font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                  onClick={clearAll}
                >
                  Clear
                </button>

                <button
                  type="button"
                  className="rounded-lg px-2.5 py-1 text-[11px] border-none cursor-pointer bg-transparent font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    if (allSelected) clearAll();
                    else selectAll();
                  }}
                >
                  {allSelected ? "Unselect all" : "Select all"}
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto overflow-x-hidden p-2">
              {filteredOptions.length === 0 ? (
                <div className="rounded-xl px-3 py-3 text-sm text-muted-foreground">
                  {emptyMessage}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredOptions.map((option) => {
                    const checked = selectedSet.has(option.value);

                    return (
                      <label
                        key={option.value}
                        className="flex min-h-9 cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-accent/60"
                      >
                        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer rounded border-border"
                            checked={checked}
                            onChange={() => toggleValue(option.value)}
                          />
                          {checked ? (
                            <Check className="pointer-events-none absolute h-3.5 w-3.5 text-foreground" />
                          ) : null}
                        </div>

                        <span
                          className="truncate text-sm text-foreground"
                          title={option.label}
                        >
                          {option.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}