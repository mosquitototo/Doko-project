import type { ButtonHTMLAttributes, ComponentType } from "react";
import { cn } from "../../lib/utils";
import {
  Plus,
  Save,
  RefreshCw,
  Eye,
  Link as LinkIcon,
  Merge,
  Ban,
  DoorClosed,
  DoorOpen,
  Search,
  ExternalLink,
  EyeOff,
  Copy,
  Trash2,
  RotateCcwKey,
  SquarePen,
  CheckCheck,
  SpellCheck2,
  UserRoundPlus,
  HousePlus,
  Blocks,
  UserRoundPen,
  UserRoundSearch,
  UserRoundCheck,
  ScanEye,
  CircleX,
  FileArchive,
  ListRestart,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Unlink,
  Send,
  Reply,
  ReplyAll,
  Eraser,
  ReceiptText,
  Power,
  Highlighter,
  Code,
  Play,
} from "lucide-react";

export {
  Workflow,
  Kanban,
  NotebookText,
  Info,
  UserRound,
  UserRoundSearch,
  Activity,
  Megaphone,
  Siren,
  BriefcaseBusiness,
  Binoculars,
  LayoutDashboard,
  House,
  Sticker,
  Cat,
  MessageSquare,
  Search,
  Eraser,
  X, 
  Play, 
  RefreshCw, 
  PlugZap,
  PawPrint,
  BookOpen,
  ChevronDown,
  ChevronUp,
  SquareCheckBig,
  CalendarClock,
  Copy,
  ExternalLink,
  Check,
  Moon, 
  Sun, 
  LogOut, 
  User, 
  Settings2,
  Pencil, 
  Paperclip, 
  Link, 
  Unlink, 
  Power, 
  Trash2,
  CheckCircle2, 
  AlertTriangle,
  ArrowRight,
  Filter,
  LayoutGrid,
  RotateCcw,
  GripVertical,
  SlidersHorizontal,
  SearchCode, 
  PlusCircle,
  Clock3, 
} from "lucide-react";

type IconComp = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type Variant =
  | "primary"
  | "secondary"
  | "danger"
  | "warning"
  | "success"
  | "clear";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  label?: string;
  icon?: IconComp;
  variant?: Variant;
  className?: string;
  loading?: boolean;
  iconOnly?: boolean;
};

function classesForVariant(variant: Variant) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-all duration-200";
  const layout =
    "min-h-10 px-3 py-2 whitespace-nowrap select-none";
  const states =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const interactions =
    "disabled:pointer-events-none disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985]";
  const shadows =
    "shadow-sm hover:shadow-md";
  const common = `${base} ${layout} ${states} ${interactions} ${shadows}`;

  if (variant === "primary") {
    return cn(
      common,
      "border-none bg-primary text-primary-foreground",
      "hover:brightness-105"
    );
  }

  if (variant === "secondary") {
    return cn(
      common,
      "border-none bg-secondary text-secondary-foreground",
      "hover:bg-accent hover:text-accent-foreground",
      "dark:shadow-md"
    );
  }

  if (variant === "danger") {
    return cn(
      common,
      "border-none bg-red-900 text-white shadow-lg",
      "hover:bg-red-950 hover:border-red-900/40 transition-all duration-200",
      "dark:bg-red-900/80 dark:hover:bg-red-900 dark:border-red-500/20"
    );
  }

  if (variant === "warning") {
    return cn(
      common,
      "border border-amber-200/50 bg-amber-50/50 text-amber-700",
      "transition-all duration-200 hover:bg-amber-100/80 hover:border-amber-300 active:scale-[0.98]",
      "dark:border-amber-500/10 dark:bg-amber-500/5 dark:text-amber-400 dark:hover:bg-amber-500/10 dark:hover:border-amber-500/20"
    );
  }

  if (variant === "success") {
    return cn(
      common,
      "border-none bg-green-700 text-white",
      "hover:bg-green-800 active:scale-[0.98] transition-all duration-200",
      "dark:bg-green-800 dark:text-white"
    );
  }

  return cn(
    common,
    "border-transparent bg-transparent text-muted-foreground",
    "hover:bg-accent hover:text-accent-foreground"
  );
}

export function ActionButton({
  label,
  title,
  icon: Icon,
  variant = "secondary",
  className = "",
  loading = false,
  disabled,
  type,
  iconOnly,
  ...rest
}: Props) {
  const isDisabled = !!disabled || loading;

  const ariaLabel =
    (label && label.trim().length > 0 ? label : undefined) ??
    (typeof title === "string" && title.trim().length > 0 ? title : undefined);

  return (
    <button
      type={type ?? "button"}
      title={typeof title === "string" ? title : undefined}
      aria-label={ariaLabel}
      disabled={isDisabled}
      className={cn(
        classesForVariant(variant),
        iconOnly ? "h-10 w-10 min-h-0 px-0 py-0" : "",
        loading ? "cursor-wait" : "cursor-pointer",
        className
      )}
      {...rest}
    >
      {Icon ? (
        <Icon
          className={cn("h-4 w-4 shrink-0", loading ? "animate-spin" : "")}
          aria-hidden={true}
        />
      ) : null}

      {!iconOnly && ariaLabel ? <span>{loading ? "Loading" : ariaLabel}</span> : null}
    </button>
  );
}

type QuickProps = Omit<Props, "label" | "icon"> & { label?: string };

export function CancelButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Cancel"}
      icon={CircleX}
      variant="warning"
      {...props}
    />
  );
}

export function SaveButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Save"}
      icon={Save}
      variant="success"
      {...props}
    />
  );
}

export function ResetPasswordButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Reset password"}
      icon={RotateCcwKey}
      variant="danger"
      {...props}
    />
  );
}

export function DisplayPasswordButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Display password"}
      icon={Eye}
      variant="secondary"
      {...props}
    />
  );
}

export function HidePasswordButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Hide password"}
      icon={EyeOff}
      variant="secondary"
      {...props}
    />
  );
}

export function DisableButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Disable"}
      icon={Ban}
      variant="danger"
      {...props}
    />
  );
}

export function GenerateLinkButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Generate link"}
      icon={LinkIcon}
      variant="warning"
      {...props}
    />
  );
}

export function NewGenButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "New"}
      icon={Plus}
      variant="primary"
      {...props}
    />
  );
}

export function NewCustomerButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "New customer"}
      icon={HousePlus}
      variant="primary"
      {...props}
    />
  );
}

export function NewUserButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "New user"}
      icon={UserRoundPlus}
      variant="primary"
      {...props}
    />
  );
}

export function NewRoleButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "New role"}
      icon={Blocks}
      variant="primary"
      {...props}
    />
  );
}

export function EditGenButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Edit"}
      icon={SquarePen}
      variant="primary"
      {...props}
    />
  );
}

export function EditUserButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Edit user"}
      icon={UserRoundPen}
      variant="primary"
      {...props}
    />
  );
}

export function PreviewButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Preview"}
      icon={ScanEye}
      variant="primary"
      {...props}
    />
  );
}

export function RefreshButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Refresh"}
      icon={RefreshCw}
      variant="secondary"
      {...props}
    />
  );
}

export function MergeButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Merge this alert into a case"}
      icon={Merge}
      variant="primary"
      {...props}
    />
  );
}

export function UnMergeButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Merge this alert into a case"}
      icon={Unlink}
      variant="warning"
      {...props}
    />
  );
}

export function AssignGenButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Assign"}
      icon={UserRoundSearch}
      variant="secondary"
      {...props}
    />
  );
}

export function AssignMeButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Assign me"}
      icon={UserRoundCheck}
      variant="secondary"
      {...props}
    />
  );
}

export function CloseButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Close"}
      icon={DoorClosed}
      variant="warning"
      {...props}
    />
  );
}

export function OpenButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Open"}
      icon={DoorOpen}
      variant="success"
      {...props}
    />
  );
}

export function PlayButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "In progress"}
      icon={Play}
      variant="secondary"
      {...props}
    />
  );
}

export function PasswordSpellErrorButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Password does not match"}
      icon={SpellCheck2}
      variant="danger"
      {...props}
    />
  );
}

export function PasswordSpellValidButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Password matches"}
      icon={CheckCheck}
      variant="success"
      {...props}
    />
  );
}

export function DeleteButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Delete"}
      icon={Trash2}
      variant="danger"
      {...props}
    />
  );
}

export function ArchiveButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Archive"}
      icon={FileArchive}
      variant="warning"
      {...props}
    />
  );
}

export function ResetButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Reset"}
      icon={ListRestart}
      variant="warning"
      {...props}
    />
  );
}

export function UpButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Up"}
      icon={ArrowUp}
      {...props}
    />
  );
}

export function DownButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Down"}
      icon={ArrowDown}
      {...props}
    />
  );
}

export function LeftButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Left"}
      icon={ArrowLeft}
      {...props}
    />
  );
}

export function RightButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Right"}
      icon={ArrowRight}
      {...props}
    />
  );
}

export function OpenGenButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Open"}
      icon={ExternalLink}
      {...props}
    />
  );
}

export function SendButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Send"}
      icon={Send}
      {...props}
    />
  );
}

export function ReplyButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Reply"}
      icon={Reply}
      {...props}
    />
  );
}

export function ReplyAllButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Reply all"}
      icon={ReplyAll}
      {...props}
    />
  );
}

export function ClearButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Clear"}
      variant="clear"
      icon={Eraser}
      {...props}
    />
  );
}

export function DetailButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Details"}
      variant="clear"
      icon={ReceiptText}
      {...props}
    />
  );
}

export function CopyButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Copy"}
      variant="success"
      icon={Copy}
      {...props}
    />
  );
}

export function PowerOnButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Power"}
      variant="success"
      icon={Power}
      {...props}
    />
  );
}

export function HighlightButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Highlight"}
      variant="clear"
      icon={Highlighter}
      {...props}
    />
  );
}

export function CodeButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Code"}
      variant="clear"
      icon={Code}
      {...props}
    />
  );
}

export function SearchButton(props: QuickProps) {
  return (
    <ActionButton
      iconOnly={props.iconOnly ?? true}
      title={props.title ?? "Search"}
      variant="clear"
      icon={Search}
      {...props}
    />
  );
}

type ToggleOpenCloseProps = Omit<Props, "icon" | "variant"> & {
  isOpen: boolean;
  openLabel?: string;
  closedLabel?: string;
  openTitle?: string;
  closedTitle?: string;
};


type ToggleOpenInProgressCloseProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "status"
> & {
  status: "open" | "in_progress" | "closed" | "merged" | string;
  openLabel?: string;
  inProgressLabel?: string;
  closedLabel?: string;
  openTitle?: string;
  inProgressTitle?: string;
  closedTitle?: string;
  iconOnly?: boolean;
};


export function OpenCloseToggleButton({
  isOpen,
  openLabel = "Close",
  closedLabel = "Re-open",
  openTitle = "Close this alert",
  closedTitle = "Re-open this alert",
  iconOnly,
  ...props
}: ToggleOpenCloseProps) {
  const only = iconOnly ?? true;

  if (isOpen) {
    return (
      <ActionButton
        {...props}
        icon={DoorClosed}
        variant="warning"
        title={openTitle}
        label={openLabel}
        iconOnly={only}
      />
    );
  }

  return (
    <ActionButton
      {...props}
      icon={DoorOpen}
      variant="success"
      title={closedTitle}
      label={closedLabel}
      iconOnly={only}
      className={cn("text-nowrap", props.className)}
    />
  );
}


export function OpenInProgressCloseToggleButton({
  status,
  openLabel = "In progress",
  inProgressLabel = "Close",
  closedLabel = "Re-open",
  openTitle = "Mark as in progress",
  inProgressTitle = "Close this alert",
  closedTitle = "Re-open this alert",
  iconOnly,
  ...props
}: ToggleOpenInProgressCloseProps) {
  const only = iconOnly ?? true;

  if (status === "closed") {
    return (
      <ActionButton
        {...props}
        icon={DoorOpen}
        variant="success"
        title={closedTitle}
        label={closedLabel}
        iconOnly={only}
        className={cn("text-nowrap", props.className)}
      />
    );
  }

  if (status === "open") {
    return (
      <ActionButton
        {...props}
        icon={Play}
        variant="secondary"
        title={openTitle}
        label={openLabel}
        iconOnly={only}
      />
    );
  }

  return (
    <ActionButton
      {...props}
      icon={DoorClosed}
      variant="warning"
      title={inProgressTitle}
      label={inProgressLabel}
      iconOnly={only}
    />
  );
}