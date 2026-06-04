import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { useUiAccess } from "../hooks/useUiAccess";
import { useMe, useReloadMe } from "../contexts/MeContext";
import {
  updateMe,
  changePassword,
  uploadAvatar,
  listMyApiTokens,
  createMyApiToken,
  revokeMyApiToken,
  type MyApiToken,
} from "../api/preferences";
import {
  CancelButton,
  SaveButton,
  ResetPasswordButton,
  DisplayPasswordButton,
  HidePasswordButton,
  CopyButton,
  DeleteButton,
  RefreshButton,
} from "../components/ui/IconButton";

type TimezoneOpt = { value: string; label: string };

const TIMEZONE_OPTIONS: TimezoneOpt[] = [
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Europe/Madrid", label: "Europe/Madrid" },
  { value: "Europe/Rome", label: "Europe/Rome" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam" },
  { value: "Europe/Brussels", label: "Europe/Brussels" },
  { value: "Europe/Zurich", label: "Europe/Zurich" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "America/Toronto", label: "America/Toronto" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
  { value: "Asia/Dubai", label: "Asia/Dubai" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Seoul", label: "Asia/Seoul" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </label>
  );
}

function EyeToggle(props: {
  shown: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      disabled={props.disabled}
      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      aria-label={props.shown ? "Hide password" : "Show password"}
      title={props.shown ? "Hide" : "Show"}
    >
      {props.shown ? <HidePasswordButton /> : <DisplayPasswordButton />}
    </button>
  );
}

type ChangePasswordModalProps = {
  open: boolean;
  busy: boolean;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  onChangeCurrent: (v: string) => void;
  onChangeNew: (v: string) => void;
  onChangeConfirm: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};


function isValidOptionalEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}


const MAX_API_TOKENS = 3;


function isTokenExpired(token: MyApiToken) {
  if (!token.expiry) return false;

  const ts = new Date(token.expiry).getTime();

  if (Number.isNaN(ts)) return false;

  return ts <= Date.now();
}


function tokenExpiryLabel(token: MyApiToken) {
  if (!token.expiry) return "Never expires";

  const date = new Date(token.expiry);

  if (Number.isNaN(date.getTime())) return "Invalid expiration";

  return `Expiry: ${date.toLocaleString()}`;
}


function validatePassword(value: string) {
  if (value.length < 12) return "Password must contain at least 12 characters.";
  return "";
}


function ChangePasswordModal(props: ChangePasswordModalProps) {
  const {
    open,
    busy,
    currentPassword,
    newPassword,
    confirmNewPassword,
    onChangeCurrent,
    onChangeNew,
    onChangeConfirm,
    onClose,
    onSubmit,
  } = props;

  const currentPwRef = useRef<HTMLInputElement | null>(null);

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => currentPwRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const matchState = useMemo(() => {
    const a = (newPassword ?? "").trim();
    const b = (confirmNewPassword ?? "").trim();
    if (!a && !b) return "empty" as const;
    if (!a || !b) return "typing" as const;
    return a === b ? ("match" as const) : ("mismatch" as const);
  }, [newPassword, confirmNewPassword]);

  const canSubmit =
    !busy &&
    !!currentPassword &&
    !!newPassword &&
    !!confirmNewPassword &&
    matchState === "match";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close"
      />

      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2">
        <Card className="border-border bg-card/95 p-0 shadow-panel backdrop-blur-xl">
          <div
            className="rounded-[28px] border border-border bg-card"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-4">
              <div className="text-lg font-semibold text-foreground">
                Change password
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Update your account password securely.
              </div>
            </div>

            <div className="grid gap-4 px-5 py-5">
              <div>
                <FieldLabel>Current password</FieldLabel>
                <div className="relative">
                  <input
                    ref={currentPwRef}
                    type={showCurrent ? "text" : "password"}
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={currentPassword}
                    onChange={(e) => onChangeCurrent(e.target.value)}
                    disabled={busy}
                    autoComplete="current-password"
                  />
                  <EyeToggle
                    shown={showCurrent}
                    onToggle={() => setShowCurrent((v) => !v)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>New password</FieldLabel>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={newPassword}
                    onChange={(e) => onChangeNew(e.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                  />
                  <EyeToggle
                    shown={showNew}
                    onToggle={() => setShowNew((v) => !v)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Confirm new password</FieldLabel>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={confirmNewPassword}
                    onChange={(e) => onChangeConfirm(e.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSubmit) onSubmit();
                    }}
                  />
                  <EyeToggle
                    shown={showConfirm}
                    onToggle={() => setShowConfirm((v) => !v)}
                    disabled={busy}
                  />
                </div>

                <div className="mt-2 text-xs">
                  {matchState === "empty" ? (
                    <span className="text-muted-foreground">
                      Type the new password twice.
                    </span>
                  ) : matchState === "typing" ? (
                    <span className="text-muted-foreground">Keep typing…</span>
                  ) : matchState === "match" ? (
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      Passwords match
                    </span>
                  ) : (
                    <span className="font-medium text-destructive">
                      Passwords do not match
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <CancelButton type="button" onClick={onClose} disabled={busy} />
              <SaveButton
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                title="Update password"
              >
                {busy ? "Saving…" : "Update"}
              </SaveButton>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function Preferences() {
  const { push, handleActionError } = useUiAccess();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const me = useMe();
  const reloadMe = useReloadMe();

  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("Europe/Paris");

  const [pwOpen, setPwOpen] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenItems, setTokenItems] = useState<MyApiToken[]>([]);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [tokenNeverExpire, setTokenNeverExpire] = useState(false);

  const dirty =
    !!me &&
    (email.trim() !== (me.email ?? "") ||
      timezone.trim() !== (me.timezone ?? "Europe/Paris"));

  useEffect(() => {
    if (!me) return;
    setEmail(me.email ?? "");
    setTimezone(me.timezone ?? "Europe/Paris");
  }, [me]);

  async function saveProfile() {
    if (saving || !me) return;
    if (!isValidOptionalEmail(email)) {
      push({
        kind: "error",
        title: "Invalid email",
        message: "Email must be valid or left empty.",
      });
      return;
    }
    setSaving(true);
    try {
      await updateMe({ email: email.trim(), timezone: timezone.trim() });
      push({ kind: "success", title: "Saved" });
      await reloadMe();
    } catch (e: any) {
      handleActionError(e, "update your profile", "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  }

  function openChangePassword() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPwOpen(true);
  }

  function closeChangePassword() {
    if (pwBusy) return;
    setPwOpen(false);
  }

  async function doChangePassword() {
    if (pwBusy) return;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      push({
        kind: "error",
        title: "Missing information",
        message: "Please fill all password fields.",
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      push({
        kind: "error",
        title: "Password mismatch",
        message: "The new password and its confirmation do not match.",
      });
      return;
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      push({
        kind: "error",
        title: "Weak password",
        message: passwordError,
      });
      return;
    }

    setPwBusy(true);
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      push({ kind: "success", title: "Password updated" });
      setPwOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (e: any) {
      handleActionError(
        e,
        "change your password",
        "Unable to update password."
      );
    } finally {
      setPwBusy(false);
    }
  }

  async function loadTokens() {
    setTokenBusy(true);

    try {
      const tokens = await listMyApiTokens();
      setTokenItems(tokens);
    } catch (e: any) {
      setTokenItems([]);
      handleActionError(e, "load API tokens", "Unable to load API tokens.");
    } finally {
      setTokenBusy(false);
    }
  }

  function openTokens() {
    setNewTokenValue("");
    setTokenExpiresAt("");
    setTokenNeverExpire(false);
    setTokenOpen(true);
    void loadTokens();
  }

  function closeTokens() {
    if (tokenBusy) return;

    setTokenOpen(false);
    setTokenItems([]);
    setNewTokenValue("");
    setTokenExpiresAt("");
    setTokenNeverExpire(false);
  }

  async function generateToken() {
    if (tokenBusy || tokenItems.length >= MAX_API_TOKENS) return;

    const expiresAt = tokenNeverExpire || !tokenExpiresAt ? null : new Date(tokenExpiresAt);

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      push({
        kind: "error",
        title: "Invalid expiration",
        message: "Expiration date is invalid.",
      });
      return;
    }

    if (expiresAt && expiresAt <= new Date()) {
      push({
        kind: "error",
        title: "Invalid expiration",
        message: "Expiration date must be in the future.",
      });
      return;
    }

    setTokenBusy(true);

    try {
      const res = await createMyApiToken(
        expiresAt ? expiresAt.toISOString() : null,
        tokenNeverExpire
      );

      setNewTokenValue(String(res?.token || ""));
      const tokens = await listMyApiTokens();
      setTokenItems(tokens);
      push({ kind: "success", title: "API token generated" });
    } catch (e: any) {
      handleActionError(e, "generate API token", "Unable to generate API token.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeToken(id: string) {
    if (tokenBusy) return;

    setTokenBusy(true);

    try {
      await revokeMyApiToken(id);
      const tokens = await listMyApiTokens();
      setTokenItems(tokens);
      push({ kind: "success", title: "API token revoked" });
    } catch (e: any) {
      handleActionError(e, "revoke API token", "Unable to revoke API token.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function onPickAvatar(file: File) {
    if (!file.type.startsWith("image/")) {
      push({
        kind: "error",
        title: "Invalid avatar",
        message: "Avatar must be an image.",
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      push({
        kind: "error",
        title: "Invalid avatar",
        message: "Avatar must be smaller than 2 MB.",
      });
      return;
    }
    setAvatarBusy(true);
    try {
      await uploadAvatar({ file });
      push({ kind: "success", title: "Avatar updated" });
      await reloadMe();
    } catch (e: any) {
      handleActionError(
        e,
        "update your avatar",
        "Unable to update avatar."
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  if (!me) {
    return (
      <div className="space-y-6">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Preferences
          </div>
          <div className="mt-1 text-sm text-muted-foreground">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Preferences
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Manage your profile and account settings
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              className="group relative cursor-pointer border-none bg-transparent"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              <div className="relative h-28 w-28 overflow-hidden rounded-[28px] border border-border bg-background shadow-panel transition group-hover:scale-[1.02]">
                {me.avatar_url ? (
                  <img
                    src={me.avatar_url}
                    alt="avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    No avatar
                  </div>
                )}

                <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] font-semibold uppercase tracking-[0.16em] text-white opacity-0 transition group-hover:opacity-100">
                  {avatarBusy ? "Saving…" : "Change"}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickAvatar(file);
                  e.currentTarget.value = "";
                }}
              />
            </button>

            <div className="mt-5">
              <div className="text-xl font-semibold tracking-tight text-foreground">
                @{me.username}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Personal account settings
              </div>
            </div>

            <div className="mt-5 w-full rounded-3xl border border-border bg-background/60 p-4 text-left">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Roles
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {me.roles && me.roles.length > 0 ? (
                  me.roles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm"
                    >
                      {role}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-lg font-semibold text-foreground">Profile</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Update your email address, timezone and security settings
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openTokens}
                disabled={saving}
                title="Manage API tokens"
                className="inline-flex h-9 cursor-pointer items-center rounded-2xl border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                API tokens
              </button>

              <ResetPasswordButton
                type="button"
                onClick={openChangePassword}
                disabled={saving}
                iconOnly={false}
                label="Change password"
                title="Change password"
              />
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <FieldLabel>Email</FieldLabel>
              <input
                className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
                placeholder="name@example.com"
              />
            </div>

            <div>
              <FieldLabel>Timezone</FieldLabel>
              <select
                className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={saving}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
                {!TIMEZONE_OPTIONS.some((x) => x.value === timezone) ? (
                  <option value={timezone}>{timezone}</option>
                ) : null}
              </select>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-xs italic text-muted-foreground">
              {dirty ? "Unsaved changes" : ""}
            </div>

            <SaveButton
              type="button"
              onClick={saveProfile}
              disabled={saving || !dirty}
              iconOnly={false}
              label={saving ? "Saving…" : "Save"}
              title="Save profile"
            >
              {saving ? "Saving…" : "Save"}
            </SaveButton>
          </div>
        </Card>
      </div>


      <ConfirmDialog
        open={tokenOpen}
        title="API tokens"
        onCancel={closeTokens}
        onConfirm={() => {}}
        confirmButton={
          <div className="flex items-center gap-2">
            <RefreshButton
              iconOnly={false}
              label={
                tokenItems.length >= MAX_API_TOKENS
                  ? "Limit reached"
                  : tokenBusy
                  ? "Generating..."
                  : "Generate"
              }
              title="Generate API token"
              disabled={tokenBusy || tokenItems.length >= MAX_API_TOKENS}
              onClick={() => void generateToken()}
            />
          </div>
        }
        message={
          <div className="space-y-4">
            {newTokenValue ? (
              <div className="space-y-2">
                <FieldLabel>New token</FieldLabel>
                <div className="relative rounded-2xl border border-border bg-background py-3 pl-3 pr-12 text-xs text-foreground">
                  <div className="break-all">{newTokenValue}</div>

                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <CopyButton
                      iconOnly={true}
                      title="Copy token to clipboard"
                      disabled={!newTokenValue || tokenBusy}
                      onClick={async () => {
                        if (!newTokenValue || tokenBusy) return;

                        try {
                          await navigator.clipboard.writeText(newTokenValue);
                          push({ kind: "success", title: "Copied" });
                        } catch {
                          push({
                            kind: "error",
                            title: "Error",
                            message: "Clipboard blocked",
                          });
                        }
                      }}
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Copy this token now. It will not be shown again.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <FieldLabel>Expiration date</FieldLabel>
              
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <input
                    type="datetime-local"
                    value={tokenExpiresAt}
                    onChange={(e) => setTokenExpiresAt(e.target.value)}
                    disabled={tokenBusy || tokenNeverExpire}
                    className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/30">
                  <span className="whitespace-nowrap text-xs text-muted-foreground">Never expire</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer rounded border-border"
                    checked={tokenNeverExpire}
                    onChange={(e) => {
                      setTokenNeverExpire(e.target.checked);
                      if (e.target.checked) setTokenExpiresAt("");
                    }}
                    disabled={tokenBusy}
                  />
                </label>
              </div>
              
              <p className="text-xs text-muted-foreground">
                Leave empty to use the default Knox expiration.
              </p>
            </div>

            <div className="space-y-2">
              <FieldLabel>
                Existing tokens ({tokenItems.length}/{MAX_API_TOKENS})
              </FieldLabel>

              <div className="max-h-[280px] overflow-y-auto rounded-2xl border border-border bg-background p-2">
                {tokenBusy ? (
                  <div className="p-3 text-sm text-muted-foreground">Loading...</div>
                ) : tokenItems.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No API tokens.</div>
                ) : (
                  <div className="space-y-2">
                    {tokenItems.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-accent/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">
                              {t.token_key}
                            </div>

                            {isTokenExpired(t) ? (
                              <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-700 dark:text-red-400">
                                Expired
                              </span>
                            ) : null}

                            {!t.expiry ? (
                              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Never expire
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 text-xs text-muted-foreground">
                            Created: {new Date(t.created).toLocaleString()} • {tokenExpiryLabel(t)}
                          </div>
                        </div>

                        <DeleteButton
                          onClick={() => void revokeToken(t.id)}
                          disabled={tokenBusy}
                          title="Revoke token"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        }
      />


      <ChangePasswordModal
        open={pwOpen}
        busy={pwBusy}
        currentPassword={currentPassword}
        newPassword={newPassword}
        confirmNewPassword={confirmNewPassword}
        onChangeCurrent={setCurrentPassword}
        onChangeNew={setNewPassword}
        onChangeConfirm={setConfirmNewPassword}
        onClose={closeChangePassword}
        onSubmit={doChangePassword}
      />
    </div>
  );
}