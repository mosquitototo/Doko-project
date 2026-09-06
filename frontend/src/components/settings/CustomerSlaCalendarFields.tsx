import { useMemo, type ReactNode } from "react";
import { DeleteButton, NewGenButton } from "../ui/IconButton";
import { calendarError, type CustomerSlaCalendar } from "../../utils/customerSlaCalendar";

const fieldClass = "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Label({ children }: { children: ReactNode }) {
  return <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</span>;
}

export default function CustomerSlaCalendarFields({ value, onChange, disabled = false }: {
  value: CustomerSlaCalendar;
  onChange: (value: CustomerSlaCalendar) => void;
  disabled?: boolean;
}) {
  const zones = useMemo(() => {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    return [...new Set(["UTC", value.timezone, ...(intl.supportedValuesOf?.("timeZone") ?? [])])].sort();
  }, [value.timezone]);
  const update = (patch: Partial<CustomerSlaCalendar>) => onChange({ ...value, ...patch });
  const dayHours = (() => {
    const minutes = (text: string) => { const [h, m] = text.split(":").map(Number); return h * 60 + m; };
    return Math.max(0, (minutes(value.work_end) - minutes(value.work_start)) / 60);
  })();

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <label className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3">
        <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-border" checked={value.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
        <span>
          <span className="block text-sm font-medium text-foreground">Working-time SLA</span>
          <span className="block text-xs text-muted-foreground">Use this customer's working calendar. When disabled, SLA durations use elapsed time.</span>
        </span>
      </label>
      {(value.enabled || calendarError(value) !== null) && (
        <div className="space-y-4 rounded-2xl border border-border p-4">
          <label className="block space-y-2">
            <Label>Customer timezone</Label>
            <select className={fieldClass} value={value.timezone} onChange={(event) => update({ timezone: event.target.value })}>
              {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <span className="block text-xs text-muted-foreground">Used only for working hours and SLA calculations, not displayed alert timestamps.</span>
          </label>
          <div className="space-y-2">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((label, day) => (
                <label key={day} className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-border" checked={value.weekdays.includes(day)} onChange={(event) => update({ weekdays: event.target.checked ? [...value.weekdays, day].sort() : value.weekdays.filter((item) => item !== day) })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2">
              <Label>Work start</Label>
              <input type="time" className={fieldClass} value={value.work_start} onChange={(event) => update({ work_start: event.target.value })} />
            </label>
            <label className="block space-y-2">
              <Label>Work end</Label>
              <input type="text" className={fieldClass} placeholder="17:00" maxLength={5} value={value.work_end} onChange={(event) => update({ work_end: event.target.value })} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Use 00:00–24:00 for all-day coverage. Start and end are on the same local day.</p>
          <label className="block space-y-2">
            <Label>Working days per SLA month</Label>
            <input type="number" min={1} max={31} step={1} className={fieldClass} value={value.month_days || ""} onChange={(event) => update({ month_days: Number(event.target.value) })} />
          </label>
          <p className="text-xs text-muted-foreground">1 day = {Number.isFinite(dayHours) ? Number(dayHours.toFixed(2)) : "—"} working hours · 1 week = {value.weekdays.length} working days · 1 month = {value.month_days || "—"} working days.</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Customer holidays</Label>
              <NewGenButton title="Add holiday" disabled={disabled || value.holidays.length >= 366} onClick={() => update({ holidays: [...value.holidays, { date: "", annual: false, label: "" }] })} />
            </div>
            <p className="text-xs text-muted-foreground">Dates apply only to this customer. Add movable holidays for each year; repeat fixed dates annually.</p>
            {value.holidays.map((holiday, index) => (
              <div key={index} className="space-y-3 rounded-2xl border border-border bg-background p-3">
                <div className="flex items-end gap-2">
                  <label className="block min-w-0 flex-1 space-y-2">
                    <Label>Date</Label>
                    <input type="date" className={fieldClass} value={holiday.date} onChange={(event) => update({ holidays: value.holidays.map((item, row) => row === index ? { ...item, date: event.target.value } : item) })} />
                  </label>
                  <DeleteButton title="Remove holiday" disabled={disabled} onClick={() => update({ holidays: value.holidays.filter((_, row) => row !== index) })} />
                </div>
                <label className="block space-y-2">
                  <Label>Label (optional)</Label>
                  <input className={fieldClass} maxLength={100} value={holiday.label} onChange={(event) => update({ holidays: value.holidays.map((item, row) => row === index ? { ...item, label: event.target.value } : item) })} />
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-border" checked={holiday.annual} onChange={(event) => update({ holidays: value.holidays.map((item, row) => row === index ? { ...item, annual: event.target.checked } : item) })} />
                  Repeat every year
                </label>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Changes apply to new alerts. Existing SLA deadlines are preserved.</p>
        </div>
      )}
    </fieldset>
  );
}
