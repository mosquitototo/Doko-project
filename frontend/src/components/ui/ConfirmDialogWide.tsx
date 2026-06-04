import type { ReactNode } from "react";
import { createPortal } from "react-dom";
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

type CancelTag = "cancel" | "primary" | "secondary" | "success" | "warning" | "danger";

export default function ConfirmDialogWide({
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
}) {
  if (!open) return null;

  const labelFor = (txt: string) => (iconOnly ? undefined : txt);

  function renderCancel() {
    if (cancelTag === "cancel") {
      return (
        <CancelButton
          iconOnly={iconOnly}
          label={labelFor(cancelText)}
          title={cancelText}
          onClick={onCancel}
        />
      );
    }

    return (
      <ActionButton
        iconOnly={iconOnly}
        label={labelFor(cancelText)}
        title={cancelText}
        variant={cancelTag}
        onClick={onCancel}
      />
    );
  }

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

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 m-0 appearance-none rounded-none border-0 bg-black/30 p-0 outline-none backdrop-blur-[3px]"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div
        className="relative w-full max-w-5xl max-h-[85vh] overflow-y-auto rounded-[28px] border border-border bg-card/95 p-6 shadow-panel backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold text-foreground">{title}</div>
        {message ? (
          <div className="mt-2 text-sm text-muted-foreground">{message}</div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          {renderCancel()}
          {renderConfirm()}
        </div>
      </div>
    </div>,
    document.body
  );
}