import {
  RefreshCw, 
  Pencil, 
  MessageSquare, 
  Paperclip, 
  Link, 
  Unlink, 
  Activity, 
  Power, 
  Trash2,
} from "../../components/ui/IconButton";
import type { LucideIcon } from "lucide-react";


function iconFor(type: string): LucideIcon {
  switch (type) {
    case "case_created":
      return Power;
    case "status_changed":
      return RefreshCw;
    case "case_updated":
      return Pencil;
    case "comment_added":
      return MessageSquare;
    case "comment_deleted":
      return Trash2;
    case "attachment_added":
      return Paperclip;
    case "attachment_deleted":
      return Trash2;
    case "alert_linked":
      return Link;
    case "alert_unmerged":
      return Unlink;
    default:
      return Activity;
  }
}

export default function TimelineIcon({ type }: { type: string }) {
  const Icon = iconFor(type);

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
      <Icon size={16} className="text-muted-foreground" />
    </div>
  );
}