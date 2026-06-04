import { useEffect, useMemo, useState } from "react";
import Card from "../../../components/ui/Card";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/toast";
import {
  listSettingsUsers,
  createSettingsUser,
  resetSettingsUserPassword,
  disableSettingsUser,
  updateUser,
  type SettingsUser,
  type SettingsUserApiToken,
  generateSettingsUserResetLink,
  listSettingsUserApiTokens,
  createSettingsUserApiToken,
  revokeSettingsUserApiToken,
} from "../../../api/settingsUsers";
import { useMe } from "../../../contexts/MeContext";
import { listRoles, type RoleItem } from "../../../api/settingsRoles";
import { api } from "../../../api/client";
import {
  NewUserButton,
  EditUserButton,
  DeleteButton,
  ResetPasswordButton,
  GenerateLinkButton,
  CopyButton,
  RefreshButton,
  DisplayPasswordButton,
  HidePasswordButton,
} from "../../../components/ui/IconButton";

type EditUserUI = {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_staff: boolean;
  role_ids: number[];
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
      {required ? <span className="ml-1 text-red-500">*</span> : null}
    </div>
  );
}

function SectionHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function SettingInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        props.className || "",
      ].join(" ")}
    />
  );
}

function SettingCheckbox({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3">
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-border"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </label>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        active
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
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
      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border-none bg-transparent text-muted-foreground transition disabled:opacity-50"
      aria-label={props.shown ? "Hide password" : "Show password"}
      title={props.shown ? "Hide" : "Show"}
    >
      {props.shown ? <HidePasswordButton /> : <DisplayPasswordButton />}
    </button>
  );
}

function validatePassword(value: string) {
  if (value.length < 12) return "Password must contain at least 12 characters.";
  return "";
}

function isValidOptionalEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

const MAX_API_TOKENS = 3;

function isTokenExpired(token: SettingsUserApiToken) {
  if (!token.expiry) return false;

  const ts = new Date(token.expiry).getTime();

  if (Number.isNaN(ts)) return false;

  return ts <= Date.now();
}

function tokenExpiryLabel(token: SettingsUserApiToken) {
  if (!token.expiry) return "Never expires";

  const date = new Date(token.expiry);

  if (Number.isNaN(date.getTime())) return "Invalid expiration";

  return `Expiry: ${date.toLocaleString()}`;
}


export default function SettingsUsers() {
  const { push } = useToast();

  const me = useMe();
  const can = (p: string) => !!me?.is_staff || !!me?.permissions?.includes(p);

  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<SettingsUser[]>([]);
  const [count, setCount] = useState(0);

  const [roles, setRoles] = useState<RoleItem[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  const [resetTarget, setResetTarget] = useState<{
    id: number;
    username: string;
  } | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [linkTarget, setLinkTarget] = useState<{
    id: number;
    username: string;
  } | null>(null);
  const [resetLink, setResetLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  const [disableTarget, setDisableTarget] = useState<{
    id: number;
    username: string;
  } | null>(null);

  const [tokenTarget, setTokenTarget] = useState<{
    id: number;
    username: string;
  } | null>(null);
  const [tokenItems, setTokenItems] = useState<SettingsUserApiToken[]>([]);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [tokenNeverExpire, setTokenNeverExpire] = useState(false);

  const canView = can("settings.access.users.view");
  const canCreate = can("settings.access.users.manage");
  const canUpdate = can("settings.access.users.manage");
  const canReset = can("settings.access.users.manage");
  const canDelete = can("settings.access.users.delete");
  const canManageTokens = can("settings.access.users.manage");

  const [editUI, setEditUI] = useState<EditUserUI | null>(null);

  const visible = useMemo(() => items, [items]);

  async function load() {
    if (!canView) return;
    setLoading(true);
    try {
      const res = await listSettingsUsers({
        q,
        include_inactive: includeInactive,
      });
      setItems(res.results);
      setCount(res.count);
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadRoles() {
    try {
      const r = await listRoles();
      setRoles(r);
    } catch {
      setRoles([]);
    }
  }

  useEffect(() => {
    if (!canView) return;
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive, canView]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  async function openEditUser(u: SettingsUser) {
    if (!canUpdate) return;

    try {
      const res = await api.get(`/api/settings/users/${u.id}/`);
      const roleIds: number[] = Array.isArray(res.data?.role_ids)
        ? res.data.role_ids
        : [];
      setEditUI({
        id: u.id,
        username: u.username,
        email: u.email || "",
        is_active: u.is_active,
        is_staff: (u as any).is_staff ?? false,
        role_ids: roleIds,
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
      setEditUI(null);
    }
  }

  function toggleRole(roleId: number) {
    setEditUI((prev) => {
      if (!prev) return prev;
      const exists = prev.role_ids.includes(roleId);
      const next = exists
        ? prev.role_ids.filter((x) => x !== roleId)
        : uniq([...prev.role_ids, roleId]);
      return { ...prev, role_ids: next };
    });
  }

  async function openTokens(u: SettingsUser) {
    if (!canManageTokens) return;

    setTokenTarget({ id: u.id, username: u.username });
    setNewTokenValue("");
    setTokenExpiresAt("");
    setTokenNeverExpire(false);
    setTokenBusy(true);
    try {
      const tokens = await listSettingsUserApiTokens(u.id);
      setTokenItems(tokens);
    } catch (e: any) {
      setTokenItems([]);
      push({
        kind: "error",
        title: "Error",
        message: String(e?.response?.status ?? "network"),
      });
    } finally {
      setTokenBusy(false);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-3">
        <div className="text-3xl font-semibold tracking-tight text-foreground">
          Users
        </div>
        <div className="text-sm text-muted-foreground">Access denied.</div>
      </div>
    );
  }

  const sortedRoles = roles.slice().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Users
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Manage platform users, privileges, roles and password reset actions.
          </div>
        </div>

        {canCreate ? (
          <NewUserButton
            onClick={() => {
              setCreateOpen(true);
              setCreateUsername("");
              setCreateEmail("");
              setCreatePassword("");
              setShowCreatePassword(false);
            }}
            disabled={loading}
            title="New user"
            iconOnly={false}
            label="New user"
          />
        ) : null}
      </div>

      <Card className="p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="text-sm font-semibold text-foreground">
              User directory
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatPill>{count} total</StatPill>
              <StatPill>
                {items.filter((x) => x.is_active).length} active
              </StatPill>
            </div>
          </div>

          <div className="min-w-0">
            <SettingCheckbox
              checked={includeInactive}
              onChange={setIncludeInactive}
              disabled={loading}
              label="Include inactive"
              hint="Show disabled users in the list."
            />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <label className="block space-y-2">
          <FieldLabel>Search</FieldLabel>
          <SettingInput
            placeholder="Search by username..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 w-full animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-lg font-semibold text-foreground">No users</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Try another search.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-12 gap-3 border-b border-border bg-background/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <div className="col-span-3">Username</div>
                <div className="col-span-4">Email</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1">Admin</div>
                <div className="col-span-3 text-right">Actions</div>
              </div>

              <div className="divide-y divide-border">
                {visible.map((u) => (
                  <div
                    key={u.id}
                    className="grid grid-cols-12 items-center gap-3 px-5 py-4 transition hover:bg-accent/30"
                  >
                    <div className="col-span-3 min-w-0">
                      <div
                        className="truncate text-sm font-medium text-foreground"
                        title={u.username}
                      >
                        {u.username}
                      </div>
                    </div>

                    <div className="col-span-4 min-w-0">
                      <div
                        className="truncate text-sm text-muted-foreground"
                        title={u.email || "—"}
                      >
                        {u.email || "—"}
                      </div>
                    </div>

                    <div className="col-span-1">
                      <StatusPill active={u.is_active} />
                    </div>

                    <div className="col-span-1">
                      <StatusPill active={!!(u as any).is_staff} />
                    </div>

                    <div className="col-span-3 flex justify-end gap-2">
                      {canUpdate ? (
                        <EditUserButton
                          onClick={() => void openEditUser(u)}
                          disabled={loading}
                          title="Edit user"
                        />
                      ) : null}

                      {canReset ? (
                        <ResetPasswordButton
                          title="Reset password"
                          onClick={() => {
                            setResetTarget({ id: u.id, username: u.username });
                            setResetPassword("");
                            setShowResetPassword(false);
                          }}
                          disabled={loading}
                        />
                      ) : null}

                      {canReset ? (
                        <GenerateLinkButton
                          onClick={() => {
                            setLinkTarget({ id: u.id, username: u.username });
                            setResetLink("");
                          }}
                          disabled={loading}
                          title="Generate password reset link"
                        />
                      ) : null}

                      {canManageTokens ? (
                        <button
                          type="button"
                          onClick={() => void openTokens(u)}
                          disabled={loading}
                          title="Manage API tokens"
                          className="inline-flex cursor-pointer h-9 items-center rounded-2xl border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Tokens
                        </button>
                      ) : null}

                      {canDelete ? (
                        <DeleteButton
                          onClick={() =>
                            setDisableTarget({ id: u.id, username: u.username })
                          }
                          disabled={loading || !u.is_active || Number(me?.id) === Number(u.id)}
                          title="Disable user"
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={createOpen}
        title="Create user"
        confirmTag="save"
        cancelTag="cancel"
        confirmText="Create"
        onCancel={() => {
          if (loading) return;
          setCreateOpen(false);
        }}
        onConfirm={async () => {
          if (!canCreate || loading) return;
          const username = createUsername.trim();
          const password = createPassword;
          if (!username || !password) {
            push({
              kind: "error",
              title: "Missing fields",
              message: "username and password are required",
            });
            return;
          }

          const passwordError = validatePassword(password);
          if (passwordError) {
            push({
              kind: "error",
              title: "Weak password",
              message: passwordError,
            });
            return;
          }
          setLoading(true);
          try {
            if (!isValidOptionalEmail(createEmail)) {
              push({
                kind: "error",
                title: "Invalid email",
                message: "Email must be valid or left empty.",
              });
              return;
            }
            await createSettingsUser({
              username,
              email: createEmail.trim(),
              password,
            });
            push({ kind: "success", title: "User created" });
            setCreateOpen(false);
            setCreateUsername("");
            setCreateEmail("");
            setCreatePassword("");
            await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
        message={
          <div className="space-y-4">
            <label className="block space-y-2">
              <FieldLabel required>Username</FieldLabel>
              <SettingInput
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder="johndoe"
              />
            </label>

            <label className="block space-y-2">
              <FieldLabel>Email</FieldLabel>
              <SettingInput
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="john@example.com"
              />
            </label>

            <label className="block space-y-2">
              <FieldLabel required>Password</FieldLabel>
              <div className="relative">
                <SettingInput
                  type={showCreatePassword ? "text" : "password"}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-12"
                />
                <EyeToggle
                  shown={showCreatePassword}
                  onToggle={() => setShowCreatePassword((v) => !v)}
                  disabled={loading}
                />
              </div>
            </label>
          </div>
        }
      />

      <ConfirmDialog
        open={!!linkTarget}
        title="Password reset link"
        onCancel={() => {
          if (loading || linkBusy) return;
          setLinkTarget(null);
          setResetLink("");
        }}
        onConfirm={() => {}}
        confirmButton={
          <div className="flex items-center gap-2">
            <RefreshButton
              iconOnly={false}
              label={loading || linkBusy ? "Generating..." : "Generate"}
              title="Generate reset link"
              disabled={!linkTarget || !canReset || loading || linkBusy}
              onClick={async () => {
                if (!linkTarget || !canReset || loading || linkBusy) return;

                setLinkBusy(true);
                setLoading(true);
                try {
                  const res = await generateSettingsUserResetLink(linkTarget.id);
                  const path = String((res as any)?.path ?? "");
                  if (!path) throw new Error("missing path");
                  const full = new URL(path, window.location.origin).toString();
                  setResetLink(full);
                  push({ kind: "success", title: "Link generated" });
                } catch (e: any) {
                  push({
                    kind: "error",
                    title: "Error",
                    message: String(
                      e?.response?.data?.error ??
                        e?.response?.data?.detail ??
                        e?.response?.status ??
                        "network"
                    ),
                  });
                } finally {
                  setLoading(false);
                  setLinkBusy(false);
                }
              }}
            />

            <CopyButton
              iconOnly={false}
              label="Copy"
              title={resetLink ? "Copy link to clipboard" : "Generate the link first"}
              disabled={!resetLink || loading || linkBusy}
              onClick={async () => {
                if (!resetLink || loading || linkBusy) return;
                try {
                  await navigator.clipboard.writeText(resetLink);
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
        }
        message={
          linkTarget ? (
            <div className="space-y-4">
              <div className="text-sm text-foreground">
                User: <b>{linkTarget.username}</b>
              </div>

              {resetLink ? (
                <div className="space-y-2">
                  <FieldLabel>Secure link</FieldLabel>
                  <div className="rounded-2xl border border-border bg-background px-3 py-3 text-xs break-all text-foreground">
                    {resetLink}
                  </div>
                  <SectionHint>
                    Give this link to the user. It becomes invalid after password change.
                  </SectionHint>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  This will generate a secure one-time reset link.
                </div>
              )}
            </div>
          ) : (
            ""
          )
        }
      />

      <ConfirmDialog
        open={!!resetTarget}
        title="Reset password"
        message={
          resetTarget ? (
            <div className="space-y-4">
              <div className="text-sm text-foreground">
                User: <b>{resetTarget.username}</b>
              </div>

              <label className="block space-y-2">
                <FieldLabel required>New password</FieldLabel>
                <div className="relative">
                  <SettingInput
                    type={showResetPassword ? "text" : "password"}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-12"
                  />
                  <EyeToggle
                    shown={showResetPassword}
                    onToggle={() => setShowResetPassword((v) => !v)}
                    disabled={loading}
                  />
                </div>
              </label>
            </div>
          ) : (
            ""
          )
        }
        confirmText="Save password"
        confirmTag="save"
        onCancel={() => {
          if (loading) return;
          setResetTarget(null);
        }}
        onConfirm={async () => {
          if (!resetTarget || !canReset || loading) return;
          if (!resetPassword) {
            push({ kind: "error", title: "Missing password" });
            return;
          }
          const passwordError = validatePassword(resetPassword);
          if (passwordError) {
            push({
              kind: "error",
              title: "Weak password",
              message: passwordError,
            });
            return;
          }
          setLoading(true);
          try {
            await resetSettingsUserPassword(resetTarget.id, resetPassword);
            push({ kind: "success", title: "Password updated" });
            setResetTarget(null);
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
      />

      <ConfirmDialog
        open={!!disableTarget}
        title="Disable user"
        message={
          disableTarget
            ? `Disable "${disableTarget.username}" ? (soft delete: is_active=false)`
            : ""
        }
        confirmText="Disable"
        onCancel={() => {
          if (loading) return;
          setDisableTarget(null);
        }}
        onConfirm={async () => {
          if (!disableTarget || !canDelete || loading) return;
          if (Number(me?.id) === Number(disableTarget.id)) {
            push({
              kind: "error",
              title: "Invalid change",
              message: "You cannot disable your own account.",
            });
            return;
          }
          setLoading(true);
          try {
            await disableSettingsUser(disableTarget.id);
            push({ kind: "success", title: "User disabled" });
            setDisableTarget(null);
            await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
      />

      <ConfirmDialog
        open={!!tokenTarget}
        title="API tokens"
        onCancel={() => {
          if (loading || tokenBusy) return;
          setTokenTarget(null);
          setTokenItems([]);
          setNewTokenValue("");
          setTokenExpiresAt("");
          setTokenNeverExpire(false);
        }}
        onConfirm={() => {}}
        confirmButton={
          <div className="flex items-center gap-2">
            <RefreshButton
              iconOnly={false}
              label={
                tokenItems.length >= MAX_API_TOKENS
                  ? "Limit reached"
                  : loading || tokenBusy
                  ? "Generating..."
                  : "Generate"
              }
              title="Generate API token"
              disabled={
                !tokenTarget ||
                !canManageTokens ||
                loading ||
                tokenBusy ||
                tokenItems.length >= MAX_API_TOKENS
              }
              onClick={async () => {
                if (!tokenTarget || !canManageTokens || loading || tokenBusy) return;

                setTokenBusy(true);
                setLoading(true);
                try {
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
                  const res = await createSettingsUserApiToken(
                    tokenTarget.id,
                    expiresAt ? expiresAt.toISOString() : null,
                    tokenNeverExpire
                  );
                  setNewTokenValue(res.token);
                  const tokens = await listSettingsUserApiTokens(tokenTarget.id);
                  setTokenItems(tokens);
                  push({ kind: "success", title: "API token generated" });
                } catch (e: any) {
                  push({
                    kind: "error",
                    title: "Error",
                    message: String(
                      e?.response?.data?.detail ??
                        e?.response?.status ??
                        "network"
                    ),
                  });
                } finally {
                  setLoading(false);
                  setTokenBusy(false);
                }
              }}
            />
          </div>
        }
        message={
          tokenTarget ? (
            <div className="space-y-4">
              <div className="text-sm text-foreground">
                User: <b>{tokenTarget.username}</b>
              </div>

              {newTokenValue ? (
                <div className="space-y-2">
                  <FieldLabel>New token</FieldLabel>
                  <div className="relative rounded-2xl border border-border bg-background py-3 pl-3 pr-12 text-xs text-foreground">
                    <div className="break-all mr-3">{newTokenValue}</div>

                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <CopyButton
                        iconOnly={true}
                        title="Copy token to clipboard"
                        disabled={!newTokenValue || loading || tokenBusy}
                        onClick={async () => {
                          if (!newTokenValue || loading || tokenBusy) return;

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
                  <SectionHint>
                    Copy this token now. It will not be shown again.
                  </SectionHint>
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
                      disabled={!canManageTokens || loading || tokenBusy || tokenNeverExpire}
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
                      disabled={!canManageTokens || loading || tokenBusy}
                    />
                  </label>
                </div>
                
                <SectionHint>
                  Leave empty to use the default expiration : 30 days.
                </SectionHint>
              </div>

              <div className="space-y-2">
                <FieldLabel>
                  Existing tokens ({tokenItems.length}/{MAX_API_TOKENS})
                </FieldLabel>

                <div className="max-h-[280px] overflow-y-auto rounded-2xl border border-border bg-background p-2">
                  {tokenBusy ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      Loading...
                    </div>
                  ) : tokenItems.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No API tokens.
                    </div>
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
                            onClick={async () => {
                              if (!tokenTarget || !canManageTokens || loading || tokenBusy) return;

                              setTokenBusy(true);
                              try {
                                await revokeSettingsUserApiToken(tokenTarget.id, t.id);
                                const tokens = await listSettingsUserApiTokens(tokenTarget.id);
                                setTokenItems(tokens);
                                push({ kind: "success", title: "API token revoked" });
                              } catch (e: any) {
                                push({
                                  kind: "error",
                                  title: "Error",
                                  message: String(
                                    e?.response?.data?.detail ??
                                      e?.response?.status ??
                                      "network"
                                  ),
                                });
                              } finally {
                                setTokenBusy(false);
                              }
                            }}
                            disabled={!canManageTokens || loading || tokenBusy}
                            title="Revoke token"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            ""
          )
        }
      />

      <ConfirmDialog
        open={!!editUI}
        title="Edit user"
        confirmText="Save"
        confirmTag="save"
        onCancel={() => {
          if (loading) return;
          setEditUI(null);
        }}
        onConfirm={async () => {
          if (!editUI || !canUpdate || loading) return;
          if (!isValidOptionalEmail(editUI.email)) {
            push({
              kind: "error",
              title: "Invalid email",
              message: "Email must be valid or left empty.",
            });
            return;
          }
          setLoading(true);
          try {
            const isSelf = Number(me?.id) === Number(editUI.id);

            if (isSelf && !editUI.is_active) {
              push({
                kind: "error",
                title: "Invalid change",
                message: "You cannot disable your own account.",
              });
              return;
            }

            if (isSelf && !editUI.is_staff && me?.is_staff) {
              push({
                kind: "error",
                title: "Invalid change",
                message: "You cannot remove your own admin flag.",
              });
              return;
            }
            await updateUser(editUI.id, {
              username: editUI.username.trim(),
              email: editUI.email.trim(),
              is_active: editUI.is_active,
              is_staff: editUI.is_staff,
              role_ids: editUI.role_ids,
            });
            push({ kind: "success", title: "User updated" });
            setEditUI(null);
            if (canView) await load();
          } catch (e: any) {
            push({
              kind: "error",
              title: "Error",
              message: String(
                e?.response?.data?.detail ?? e?.response?.status ?? "network"
              ),
            });
          } finally {
            setLoading(false);
          }
        }}
        message={
          editUI ? (
            <div className="space-y-5">
              <label className="block space-y-2">
                <FieldLabel required>Username</FieldLabel>
                <SettingInput
                  value={editUI.username}
                  onChange={(e) =>
                    setEditUI({ ...editUI, username: e.target.value })
                  }
                />
              </label>

              <label className="block space-y-2">
                <FieldLabel>Email</FieldLabel>
                <SettingInput
                  value={editUI.email}
                  onChange={(e) =>
                    setEditUI({ ...editUI, email: e.target.value })
                  }
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <SettingCheckbox
                  checked={editUI.is_active}
                  onChange={(next) =>
                    setEditUI({ ...editUI, is_active: next })
                  }
                  label="User enabled"
                  hint="Disabled users cannot sign in."
                />

                <SettingCheckbox
                  checked={editUI.is_staff}
                  onChange={(next) =>
                    setEditUI({ ...editUI, is_staff: next })
                  }
                  label="Administrator"
                  hint="Grants platform-wide admin privileges."
                />
              </div>

              <div className="space-y-2">
                <FieldLabel>Roles ({editUI.role_ids.length})</FieldLabel>

                <div className="max-h-[280px] overflow-y-auto rounded-2xl border border-border bg-background p-2">
                  {sortedRoles.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No roles.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sortedRoles.map((r) => {
                        const checked = editUI.role_ids.includes(r.id);
                        return (
                          <label
                            key={r.id}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-accent/50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRole(r.id)}
                              disabled={loading}
                              className="mt-1 h-4 w-4 rounded border-border"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="break-words text-sm font-medium text-foreground">
                                {r.name}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
}