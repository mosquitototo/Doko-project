import { ChevronDown } from "../../components/ui/IconButton";

type SelectOption = {
  value: string | number;
  label: string;
};

type Props = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  widthClass?: string;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

export default function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
  widthClass = "w-full",
}: Props) {
  return (
    <div className={`${widthClass} min-w-0`}>
      <FieldLabel>{label}</FieldLabel>

      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={[
            "h-7 w-full appearance-none rounded-2xl border border-border bg-card px-3 pr-10 text-xs text-foreground shadow-sm outline-none transition",
            "focus:border-ring focus:ring-2 focus:ring-ring/20",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-ring/30 hover:bg-accent/70 hover:text-accent-foreground",
          ].join(" ")}
        >
          {options.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}