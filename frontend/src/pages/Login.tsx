import { useState } from "react";
import { useLocation } from "react-router-dom";
import { login } from "../api/auth";
import { setToken } from "../auth/auth";
import Card from "../components/ui/Card";

function FieldLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
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

function safeNextPath(value: string | null) {
  if (!value) return "/";

  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/")) return "/";
    if (decoded.startsWith("//")) return "/";
    if (decoded.includes("\\"))
      return "/";
    return decoded;
  } catch {
    return "/";
  }
}

export default function Login() {
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const params = new URLSearchParams(location.search);
  const reason = params.get("reason");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(username, password);
      setToken("session");

      const next = safeNextPath(new URLSearchParams(location.search).get("next"));

      window.location.replace(next);
      
    } catch (err: any) {
      const status = Number(err?.response?.status || 0);
      const data = err?.response?.data;

      const backendMsg =
        data?.detail ||
        (Array.isArray(data?.non_field_errors)
          ? data.non_field_errors.join(" ")
          : null) ||
        data?.error ||
        null;

      if (status === 400 || status === 401) {
        setError("Invalid username or password.");
      } else if (status === 429) {
        setError("Too many attempts. Please wait a moment and try again.");
      } else if (backendMsg) {
        setError(String(backendMsg));
      } else if (status) {
        setError("Unable to sign in right now.");
      } else {
        setError("Network error. Please check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] space-y-4">
        {reason === "expired" ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Your session expired. Please sign in again.
          </div>
        ) : null}

        <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex flex-col items-center text-center">

            <Card className="p-4 transition-all duration-300 ease-in-out hover:-translate-y-1 shadow-2xl">
              <div className="flex h-20 w-auto items-center justify-center overflow-hidden">
                <img
                  src="/Doko_logo_small.png"
                  alt="Doko logo"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </Card>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              Doko
            </h1>

            <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Case manager
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <label className="block space-y-2">
              <FieldLabel>Username</FieldLabel>
              <SettingInput
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError(null);
                }}
                autoComplete="username"
                required
                placeholder="Enter your username"
                disabled={loading}
              />
            </label>

            <label className="block space-y-2">
              <FieldLabel>Password</FieldLabel>
              <SettingInput
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                disabled={loading}
              />
            </label>

            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            ) : null}

            <div className="pt-1">
              <button
                disabled={loading}
                type="submit"
                className="w-full cursor-pointer rounded-2xl border border-transparent bg-foreground py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}