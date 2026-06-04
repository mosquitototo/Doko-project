export * from "./dashboard.types";
export * from "./addons.types";

export const statusLabel: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
  archived: "Archived",
};