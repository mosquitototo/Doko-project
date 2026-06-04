import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Card from "./Card";
import {
  ActionButton,
  CancelButton,
  DeleteButton,
  SaveButton,
  MergeButton,
  CopyButton,
} from "./IconButton";

type ConfirmTag =
  | "delete"
  | "save"
  | "merge"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "copy";

type CancelTag =
  | "cancel"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

type ConfirmDialogSize = "md" | "xl";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Delete",
  cancelText = "Cancel",
  confirmTag = "delete",
  cancelTag = "cancel",
  iconOnly = true,
  confirmButton,
  onConfirm,
  onCancel,
  size = "md",
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmTag?: ConfirmTag;
  cancelTag?: CancelTag;
  iconOnly?: boolean;
  confirmButton?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  size?: ConfirmDialogSize;
}) {
  if (!open) return null;

  const labelFor = (txt: string) => (iconOnly ? undefined : txt);

  function renderConfirm() {
    if (confirmButton) return confirmButton;

    if (confirmTag === "delete") {
      return (
        <DeleteButton
          iconOnly={iconOnly}
          label={labelFor(confirmText)}
          title={confirmText}
          onClick={onConfirm}
        />
      );
    }

    if (confirmTag === "save") {
      return (
        <SaveButton
          iconOnly={iconOnly}
          label={labelFor(confirmText)}
          title={confirmText}
          onClick={onConfirm}
        />
      );
    }

    if (confirmTag === "copy") {
      return (
        <CopyButton
          iconOnly={iconOnly}
          label={labelFor(confirmText)}
          title={confirmText}
          onClick={onConfirm}
        />
      );
    }

    if (confirmTag === "merge") {
      return (
        <MergeButton
          iconOnly={iconOnly}
          label={labelFor(confirmText)}
          title={confirmText}
          onClick={onConfirm}
        />
      );
    }

    return (
      <ActionButton
        iconOnly={iconOnly}
        label={labelFor(confirmText)}
        title={confirmText}
        variant={confirmTag}
        onClick={onConfirm}
      />
    );
  }

  const widthClass =
    size === "xl"
      ? "max-w-5xl max-h-[85vh] overflow-y-auto"
      : "max-w-md";

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-[3px]"
        onClick={onCancel}
      />

      <Card
        className={`relative w-full ${widthClass} rounded-[28px] border border-border bg-card/95 p-5 shadow-panel backdrop-blur-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 break-words text-lg font-semibold text-foreground">
            {title}
          </div>

          <CancelButton
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label="Cancel"
            title="Cancel"
          />
        </div>

        {message ? (
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            {message}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {renderConfirm()}
        </div>
      </Card>
    </div>,
    document.body
  );
}