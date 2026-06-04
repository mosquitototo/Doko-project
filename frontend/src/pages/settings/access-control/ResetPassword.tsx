import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Card from "../../../components/ui/Card";
import { useToast } from "../../../components/ui/toast";
import { confirmPasswordReset } from "../../../api/settingsUsers";
import {
  DisplayPasswordButton,
  HidePasswordButton,
} from "../../../components/ui/IconButton";

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

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}


function validatePassword(value: string) {
  if (value.length < 12) return "Password must contain at least 12 characters.";
  return "";
}


export default function ResetPassword() {
  const { push } = useToast();
  const nav = useNavigate();
  const q = useQuery();

  const uid = (q.get("uid") || "").trim();
  const token = (q.get("token") || "").trim();

  const [busy, setBusy] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [s1, setS1] = useState(false);
  const [s2, setS2] = useState(false);

  const matchState =
    !p1 && !p2
      ? "empty"
      : !p1 || !p2
      ? "typing"
      : p1 === p2
      ? "match"
      : "mismatch";

  const canSubmit =
    !!uid && !!token && !busy && !!p1 && !!p2 && matchState === "match";

  async function submit() {
    if (!canSubmit) return;

    const passwordError = validatePassword(p1);
    if (passwordError) {
      push({
        kind: "error",
        title: "Weak password",
        message: passwordError,
      });
      return;
    }
    
    setBusy(true);
    try {
      await confirmPasswordReset({ uid, token, new_password: p1 });
      push({ kind: "success", title: "Password updated" });
      nav("/login");
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
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-center p-6">
      <div className="w-full max-w-[560px] space-y-6">
        <div className="text-center">
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Reset password
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Choose a new password to recover access to your account.
          </div>
        </div>

        <Card className="p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Password recovery
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                This form requires a valid reset link.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatPill>{uid && token ? "Valid link" : "Invalid link"}</StatPill>
            </div>
          </div>

          {!uid || !token ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4">
              <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                Invalid link
              </div>
              <div className="mt-1 text-sm text-red-700/80 dark:text-red-400/80">
                The password reset link is missing or malformed.
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="rounded-2xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
                  onClick={() => nav("/login")}
                >
                  Back to login
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <label className="block space-y-2">
                <FieldLabel required>New password</FieldLabel>
                <div className="relative">
                  <SettingInput
                    type={s1 ? "text" : "password"}
                    value={p1}
                    onChange={(e) => setP1(e.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                    className="pr-12"
                  />
                  <EyeToggle
                    shown={s1}
                    onToggle={() => setS1((v) => !v)}
                    disabled={busy}
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <FieldLabel required>Confirm new password</FieldLabel>
                <div className="relative">
                  <SettingInput
                    type={s2 ? "text" : "password"}
                    value={p2}
                    onChange={(e) => setP2(e.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                    className="pr-12"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSubmit) submit();
                    }}
                  />
                  <EyeToggle
                    shown={s2}
                    onToggle={() => setS2((v) => !v)}
                    disabled={busy}
                  />
                </div>

                <SectionHint>
                  Enter the same password twice to confirm it.
                </SectionHint>
              </label>

              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                {matchState === "empty" ? (
                  <div className="text-sm text-muted-foreground">
                    Type the new password twice.
                  </div>
                ) : matchState === "typing" ? (
                  <div className="text-sm text-muted-foreground">
                    Keep typing…
                  </div>
                ) : matchState === "match" ? (
                  <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    Passwords match
                  </div>
                ) : (
                  <div className="text-sm font-medium text-red-700 dark:text-red-400">
                    Passwords do not match
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-2xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                  onClick={() => nav("/login")}
                  disabled={busy}
                >
                  Back to login
                </button>

                <button
                  type="button"
                  className="rounded-2xl border border-transparent bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                  onClick={submit}
                  disabled={!canSubmit}
                >
                  {busy ? "Saving..." : "Update"}
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}