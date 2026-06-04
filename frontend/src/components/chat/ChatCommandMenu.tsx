import { useMemo } from "react";
import type { ChatAction } from "../../api/chat";

type Props = {
  open: boolean;
  query: string;
  actions: ChatAction[];
  activeIndex: number;
  onSelect: (action: ChatAction) => void;
};

export default function ChatCommandMenu({
  open,
  query,
  actions,
  activeIndex,
  onSelect,
}: Props) {
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalized.startsWith("/")) return [];
    return actions.filter((item) => {
      const haystack = [
        item.chat_command,
        item.name,
        item.description,
        item.command_help,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalized);
    });
  }, [actions, normalized]);

  if (!open || filtered.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      <div className="max-h-72 overflow-y-auto p-1">
        {filtered.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item)}
              className={`flex w-full flex-col rounded-xl px-3 py-2 text-left ${
                active ? "bg-accent/60" : "hover:bg-accent/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">
                  {item.chat_command}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.name}
                </span>
              </div>

              {item.description ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  {item.description}
                </div>
              ) : null}

              {item.command_help ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.command_help}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}