import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function InlineEditableBadge(props: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  disabled?: boolean;
  options: { value: string; label: string }[];
  display: ReactNode;
  ariaLabel: string;
  menuAlign?: "left" | "right";
  portal?: boolean;
}) {
  const { value, onChange, disabled, options, display, ariaLabel, menuAlign = "left", portal = false } = props;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target) && !menuRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    function onViewportChange(e: Event) {
      if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    if (portal) {
      document.addEventListener("scroll", onViewportChange, true);
      window.addEventListener("resize", onViewportChange);
    }

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, portal]);

  const menu = (
        <div ref={menuRef} style={portal ? position : undefined}
          className={[
            portal ? "fixed z-[100] w-[220px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-panel" : "absolute top-full z-50 mt-2 min-w-[220px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-panel",
            !portal && (menuAlign === "right" ? "right-0" : "left-0"),
          ].filter(Boolean).join(" ")}
        >
          <div className="max-h-72 overflow-auto p-1.5">
            {options.map(option => (
              <button key={option.value} type="button" onClick={async () => { setOpen(false); if (option.value !== value) await onChange(option.value); }}
                className={["flex w-full border-none bg-transparent cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition", option.value === value ? "bg-accent border-none bg-transparent text-accent-foreground" : "text-foreground border-none bg-transparent hover:bg-accent/60"].join(" ")}>
                <span>{option.label}</span>
                {option.value === value ? <span className="text-xs text-muted-foreground">Selected</span> : null}
              </button>
            ))}
          </div>
        </div>
  );

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => {
          if (portal && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect();
            setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 236)), ...(window.innerHeight - rect.bottom < 300 ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
          }
          setOpen(prev => !prev);
        }}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {display}
      </button>

      {open && !disabled ? (portal ? createPortal(menu, document.body) : menu) : null}
    </div>
  );
}
