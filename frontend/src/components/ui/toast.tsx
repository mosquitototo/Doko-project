import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "../../components/ui/IconButton";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
};

type ToastContextValue = {
  push: (t: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function toneFor(kind: ToastKind) {
  if (kind === "success") {
    return {
      icon: CheckCircle2,
      iconClass:
        "text-emerald-600 dark:text-emerald-400",
      boxClass:
        "border-emerald-200/70 bg-white/95 dark:border-emerald-900/60 dark:bg-card/95",
    };
  }

  if (kind === "error") {
    return {
      icon: AlertTriangle,
      iconClass:
        "text-destructive",
      boxClass:
        "border-destructive/20 bg-white/95 dark:bg-card/95",
    };
  }

  return {
    icon: Info,
    iconClass:
      "text-primary",
    boxClass:
      "border-border bg-white/95 dark:bg-card/95",
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = uid();
    const toast: Toast = { id, ...t };
    setToasts((prev) => [toast, ...prev]);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="fixed right-4 top-4 z-[10000] w-[380px] max-w-[calc(100vw-2rem)] space-y-3">
        {toasts.map((t) => {
          const tone = toneFor(t.kind);
          const Icon = tone.icon;

          return (
            <div
              key={t.id}
              className={[
                "rounded-3xl border p-4 shadow-panel backdrop-blur-xl transition-all",
                tone.boxClass,
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-background">
                  <Icon className={`h-4 w-4 ${tone.iconClass}`} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {t.title}
                  </div>

                  {t.message ? (
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t.message}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                  onClick={() =>
                    setToasts((prev) => prev.filter((x) => x.id !== t.id))
                  }
                  aria-label="Close notification"
                  title="Close notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}