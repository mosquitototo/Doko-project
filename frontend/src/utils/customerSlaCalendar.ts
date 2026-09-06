export type CustomerHoliday = { date: string; annual: boolean; label: string };

export type CustomerSlaCalendar = {
  enabled: boolean;
  timezone: string;
  weekdays: number[];
  work_start: string;
  work_end: string;
  month_days: number;
  holidays: CustomerHoliday[];
};

export function customerSlaCalendar(value?: Partial<CustomerSlaCalendar> | null): CustomerSlaCalendar {
  return {
    enabled: value?.enabled ?? false,
    timezone: value?.timezone ?? "UTC",
    weekdays: [...(value?.weekdays ?? [0, 1, 2, 3, 4])],
    work_start: value?.work_start ?? "09:00",
    work_end: value?.work_end ?? "17:00",
    month_days: value?.month_days ?? 20,
    holidays: (value?.holidays ?? []).map((entry) => ({ ...entry })),
  };
}

export function calendarError(value: CustomerSlaCalendar): string | null {
  if (!value.weekdays.length) return "Choose at least one working day.";
  if (!Number.isInteger(value.month_days) || value.month_days < 1 || value.month_days > 31) return "Working days per SLA month must be between 1 and 31.";
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(value.work_start) || !(timePattern.test(value.work_end) || value.work_end === "24:00")) return "Use HH:MM for working times (24:00 is allowed for the end time).";
  if (value.work_end <= value.work_start) return "Work end must be after work start on the same day.";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format();
  } catch {
    return "Choose a valid timezone.";
  }
  for (const holiday of value.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.date)) return "Choose a date for every holiday.";
    const parsed = new Date(`${holiday.date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== holiday.date) return "Choose a valid holiday date.";
  }
  return null;
}
