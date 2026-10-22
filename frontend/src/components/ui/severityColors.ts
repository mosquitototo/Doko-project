export const severityColors = {
  gray: "border-border bg-muted text-muted-foreground",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-400/60 dark:bg-cyan-500/25 dark:text-cyan-200",
  blue: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/60 dark:bg-blue-500/25 dark:text-blue-200",
  violet: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-400/60 dark:bg-violet-500/25 dark:text-violet-200",
  pink: "border-pink-200 bg-pink-50 text-pink-800 dark:border-pink-400/60 dark:bg-pink-500/25 dark:text-pink-200",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/60 dark:bg-emerald-500/25 dark:text-emerald-200",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/60 dark:bg-amber-500/25 dark:text-amber-200",
  orange: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/60 dark:bg-orange-500/25 dark:text-orange-200",
  red: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/60 dark:bg-red-500/25 dark:text-red-200",
} as const;

export function severityColorClass(color?: string) {
  return severityColors[color as keyof typeof severityColors] ?? severityColors.gray;
}

export function legacySeverityColor(code: string) {
  return ({ low: "cyan", medium: "amber", high: "orange", critical: "red" } as Record<string, string>)[code.toLowerCase()] ?? "gray";
}
