import { Cat } from "../../components/ui/IconButton";

type GlobalChatLauncherProps = {
  onClick: () => void;
  isOpen?: boolean;
  hasActiveRun?: boolean;
  variant?: "floating" | "inline";
  showLabel?: boolean;
};

export default function GlobalChatLauncher(props: GlobalChatLauncherProps) {
  return (
    <div className="fixed bottom-5 right-5 z-40">
      <button
        type="button"
        onClick={props.onClick}
        aria-label="Open assistant"
        title="Catbot"
        className={[
          "group relative inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full",
          "border border-border bg-card/95 text-card-foreground shadow-panel backdrop-blur-xl",
          "transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "before:absolute before:inset-0 before:rounded-full before:bg-gradient-to-br before:from-primary/20 before:to-transparent before:content-['']",
          props.isOpen ? "scale-[0.98] border-primary/40 bg-accent" : "",
        ].join(" ")}
      >
        <Cat className="relative z-10 h-5 w-5" strokeWidth={2} />

        {props.hasActiveRun ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border border-card bg-emerald-500" />
          </span>
        ) : null}

        <span className="pointer-events-none absolute right-16 top-1/2 hidden -translate-y-1/2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground shadow-soft group-hover:block">
          Catbot
        </span>
      </button>
    </div>
  );
}