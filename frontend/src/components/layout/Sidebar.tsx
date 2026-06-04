import { useEffect, useState } from "react";
import { useLocation, useNavigate, NavLink } from "react-router-dom";
import type { Me } from "../../api/me";
import { listTasks, type TaskListItem } from "../../api/tasks";
import { clearToken } from "../../auth/auth";
import { useToast } from "../ui/toast";
import { useTheme } from "../theme/ThemeProvider";
import { DOKO_RELEASES_URL, DOKO_VERSION } from "../../config/version";
import {
  Siren,
  Binoculars,
  BriefcaseBusiness,
  LayoutDashboard,
  Cat,
  Search,
  PawPrint,
  SquareCheckBig,
  Moon, 
  Sun, 
  LogOut, 
  User as UserIcon, 
  Settings2,
} from "../../components/ui/IconButton";


type SidebarProps = {
  me: Me | null;
  onOpenGlobalChat: () => void;
  globalChatHasActiveRun?: boolean;
  globalChatOpen?: boolean;
};

function sectionTitle(label: string) {
  return (
    <div className="hidden px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground lg:block">
      {label}
    </div>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
    "border border-transparent",
    isActive
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
    "justify-center lg:justify-start",
  ].join(" ");

export default function Sidebar({
  me,
  onOpenGlobalChat,
  globalChatHasActiveRun = false,
  globalChatOpen = false,
}: SidebarProps) {
  if (!me) {
    return null;
  }
  
  const canAny = (ps: string[]) =>
    !!me?.is_staff ||
    !!me?.permissions?.includes("*") ||
    ps.some((p) => me?.permissions?.includes(p));

  const canDashboard = true;
  const canCases = canAny(["case.view"]);
  const canAlerts = canAny(["alert.view"]);
  const canHunts = canAny(["hunt.view"]);
  const canChat = canAny(["chat.use"]);
  const canSearch = canAny(["case.view", "alert.view", "hunt.view"]);
  const canTasks = canAny(["task.view"]);

  const showUsers = canAny([
    "settings.access.users.view",
    "settings.access.users.manage",
  ]);

  const showRoles = canAny([
    "settings.access.roles.view",
    "settings.access.roles.manage",
  ]);

  const showAccessControl = showUsers || showRoles;

  const showAudit = canAny([
    "settings.audit.view",
  ]);

  const showDataModels = canAny([
    "settings.data_models.view",
    "settings.data_models.manage",
  ]);

  const showCustomers = canAny([
    "settings.customers.view",
    "settings.customers.manage",
  ]);

  const showCaseManagement = canAny([
    "settings.case_management.view",
    "settings.case_management.manage",
  ]);

  const showWorkbooks = canAny([
    "settings.workbooks.view",
    "settings.workbooks.manage",
  ]);

  const showReports = canAny([
    "settings.reports.view",
    "settings.reports.manage",
  ]);

  const showConnectors = canAny([
    "settings.connectors.view",
    "settings.connectors.manage",
  ]);

  const showAiSoar = canAny([
    "settings.aisoar.view",
    "settings.aisoar.manage",
  ]);

  const showInstanceSettings = canAny([
    "settings.instance.manage",
  ]);

  const showDocumentation = canAny([
    "settings.documentation.view",
  ]);

  const showSettings =
    showAccessControl ||
    showAudit ||
    showDataModels ||
    showCustomers ||
    showCaseManagement ||
    showWorkbooks ||
    showReports ||
    showConnectors ||
    showAiSoar ||
    showInstanceSettings ||
    showDocumentation;

  const navigate = useNavigate();
  const { push } = useToast();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const [tasksNeedAttention, setTasksNeedAttention] = useState(false);

  const logout = () => {
    clearToken();
    push({ kind: "info", title: "Logged out" });
    navigate("/login");
  };

  const taskNeedsAttention = (task: Partial<TaskListItem>) => {
    const status = String(task?.status || "");
    if (status === "done" || status === "canceled") return false;

    const dueState = String((task as any)?.due_state || "");
    if (dueState === "overdue" || dueState === "soon") return true;

    const dueDate = (task as any)?.due_date;
    if (!dueDate) return false;

    const dueTs = new Date(dueDate).getTime();
    if (Number.isNaN(dueTs)) return false;

    const now = Date.now();
    const soonLimit = now + 48 * 60 * 60 * 1000;

    return dueTs <= soonLimit;
  };


  async function refreshTasksAttention() {
    if (!canAny(["task.view"])) {
      setTasksNeedAttention(false);
      return;
    }

    try {
      const data: any = await listTasks({
        page: 1,
        page_size: 1000,
        status: ["to_do", "in_progress"],
        ordering: "due_date",
      });
      const items = Array.isArray(data?.results) ? data.results : [];
      setTasksNeedAttention(items.some((task: TaskListItem) => taskNeedsAttention(task)));
    } catch {
      setTasksNeedAttention(false);
    }
  }

  useEffect(() => {
    void refreshTasksAttention();
  }, [me?.is_staff, me?.permissions]);

  useEffect(() => {
    function onTasksChanged() {
      void refreshTasksAttention();
    }

    window.addEventListener("doko:tasks-changed", onTasksChanged);
    return () => {
      window.removeEventListener("doko:tasks-changed", onTasksChanged);
    };
  }, [me?.is_staff, me?.permissions]);


  return (
    <aside className="sticky top-0 flex h-screen w-[84px] shrink-0 flex-col border-r border-border bg-card/80 px-2 py-3 backdrop-blur-xl lg:w-[280px] lg:px-4 lg:py-4">
      <div className="rounded-[24px] border border-border bg-background/70 p-3 shadow-soft lg:rounded-[28px] lg:p-4">
        <div className="flex items-center justify-center gap-3 lg:justify-start">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card lg:h-14 lg:w-14">
            <img
              src="/Doko_logo_small.png"
              alt="Logo"
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="hidden min-w-0 lg:block">
            <div className="text-lg font-semibold tracking-tight text-foreground">
              Doko
            </div>
            <div className="text-xs text-muted-foreground">SOC workspace</div>
          </div>
        </div>
      </div>

      <div className="my-3 h-px bg-gradient-to-r from-transparent via-border to-transparent lg:my-4" />

      <div className="rounded-[24px] border border-border bg-background/60 p-2 shadow-soft lg:rounded-[28px] lg:p-3">
        <div className="flex items-center justify-center gap-3 lg:justify-start">
          {me?.avatar_url ? (
            <img
              src={me.avatar_url}
              alt="avatar"
              className="h-10 w-10 rounded-2xl border border-border object-cover lg:h-11 lg:w-11"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-accent text-accent-foreground lg:h-11 lg:w-11">
              <UserIcon className="h-4 w-4" />
            </div>
          )}

          <div className="hidden min-w-0 flex-1 lg:block">
            <div className="truncate text-sm font-medium text-foreground">
              {me?.username || "Anonymous"}
            </div>
            <div className="text-xs text-muted-foreground">
              {me?.is_staff ? "Administrator" : "Analyst"}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col items-center gap-2 lg:flex-row">
          <button
            type="button"
            onClick={() => navigate("/preferences")}
            className="inline-flex h-9 w-9 items-center text-sm justify-center rounded-xl border-none bg-card text-card-foreground transition hover:bg-accent hover:text-accent-foreground lg:w-auto lg:flex-1 lg:gap-2 lg:px-3 transition-all duration-200 disabled:opacity-50 cursor-pointer hover:-translate-y-0.5 active:translate-y-1 active:scale-1 shadow-lg"
            title="Profile"
            aria-label="Profile"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Profile</span>
          </button>
          {canChat ? (
            <button
              type="button"
              onClick={onOpenGlobalChat}
              className={[
                "relative inline-flex h-9 w-9 items-center justify-center rounded-xl border-none bg-card text-card-foreground transition",
                "hover:bg-accent hover:text-accent-foreground",
                "transition-all duration-200 disabled:opacity-50 cursor-pointer hover:-translate-y-0.5 active:translate-y-1 active:scale-1 shadow-lg",
                globalChatOpen ? "bg-accent text-accent-foreground" : "",
              ].join(" ")}
              title="Open Catbot"
              aria-label="Open Catbot"
            >
              <Cat className="h-4 w-4" />
              {globalChatHasActiveRun ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full border border-card bg-emerald-500" />
                </span>
              ) : null}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border-none bg-card text-card-foreground transition hover:bg-accent hover:text-accent-foreground transition-all duration-200 disabled:opacity-50 cursor-pointer hover:-translate-y-0.5 active:translate-y-1 active:scale-1 shadow-lg"
            title={
              resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            aria-label={
              resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={logout}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border-none bg-card text-card-foreground transition hover:bg-destructive hover:text-destructive-foreground transition-all duration-200 disabled:opacity-50 cursor-pointer hover:-translate-y-0.5 active:translate-y-1 active:scale-1 shadow-lg"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="my-3 h-px bg-gradient-to-r from-transparent via-border to-transparent lg:my-4" />

      <nav className="flex-1 space-y-5 overflow-y-auto pb-3 lg:pb-4">
        <div className="space-y-2">
          {sectionTitle("Overview")}

          {canDashboard ? (
            <NavLink to="/" className={linkClass} end title="Dashboard">
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">Dashboard</span>
            </NavLink>
          ) : null}

          {canCases ? (
            <NavLink to="/cases" className={linkClass} title="Cases">
              <BriefcaseBusiness className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">Cases</span>
            </NavLink>
          ) : null}

          {canAlerts ? (
            <NavLink to="/alerts" className={linkClass} title="Alerts">
              <Siren className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">Alerts</span>
            </NavLink>
          ) : null}

          {canHunts ? (
            <NavLink to="/hunts" className={linkClass} title="Hunts">
              <Binoculars className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">Hunts</span>
            </NavLink>
          ) : null}

          {canChat ? (
            <NavLink to="/chatbot" className={linkClass} title="Catbot">
              <Cat className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">Catbot</span>
            </NavLink>
          ) : null}

          {canSearch ? (
            <NavLink to="/search" className={linkClass} title="Search">
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">Search</span>
            </NavLink>
          ) : null}

          {canTasks ? (
            <NavLink to="/tasks" className={linkClass} title="Tasks">
              <SquareCheckBig
                className={[
                  "h-4 w-4 shrink-0",
                  tasksNeedAttention && pathname !== "/tasks" && !pathname.startsWith("/tasks/")
                    ? "text-red-500"
                    : "",
                ].join(" ")}
              />
              <span className="hidden lg:inline">Tasks</span>
            </NavLink>
          ) : null}

        </div>

          {showSettings ? (
            <div className="space-y-2">
              {sectionTitle("Settings")}

          {showUsers ? (
            <NavLink
              to="/settings/access-control/users"
              className={linkClass}
              title="Users"
            >
              <span className="hidden lg:inline">Users</span>
              <span className="lg:hidden">U</span>
            </NavLink>
          ) : null}

          {showRoles ? (
            <NavLink
              to="/settings/access-control/roles"
              className={linkClass}
              title="Roles"
            >
              <span className="hidden lg:inline">Roles</span>
              <span className="lg:hidden">R</span>
            </NavLink>
          ) : null}

          {showAudit ? (
            <NavLink
              to="/settings/access-control/audit"
              className={linkClass}
              title="Audit"
            >
              <span className="hidden lg:inline">Audit</span>
              <span className="lg:hidden">A</span>
            </NavLink>
          ) : null}

            {showCustomers ? (
              <NavLink
                to="/settings/customers"
                className={linkClass}
                title="Customers"
              >
                <span className="hidden lg:inline">Customers</span>
                <span className="lg:hidden">C</span>
              </NavLink>
            ) : null}

            {showDataModels ? (
              <NavLink
                to="/settings/data-models"
                className={linkClass}
                title="Data models"
              >
                <span className="hidden lg:inline">Data models</span>
                <span className="lg:hidden">D</span>
              </NavLink>
            ) : null}

            {showCaseManagement ? (
              <NavLink
                to="/settings/case-management"
                className={linkClass}
                title="Case management"
              >
                <span className="hidden lg:inline">Case management</span>
                <span className="lg:hidden">CM</span>
              </NavLink>
            ) : null}

            {showWorkbooks ? (
              <NavLink
                to="/settings/workbooks"
                className={linkClass}
                title="Workbooks"
              >
                <span className="hidden lg:inline">Workbooks</span>
                <span className="lg:hidden">W</span>
              </NavLink>
            ) : null}

            {showReports ? (
              <NavLink
                to="/settings/reports"
                className={linkClass}
                title="Reports"
              >
                <span className="hidden lg:inline">Reports</span>
                <span className="lg:hidden">RP</span>
              </NavLink>
            ) : null}

            {showConnectors ? (
              <NavLink
                to="/settings/connectors"
                className={linkClass}
                title="Connectors"
              >
                <span className="hidden lg:inline">Connectors</span>
                <span className="lg:hidden">CN</span>
              </NavLink>
            ) : null}

            {showAiSoar ? (
              <NavLink
                to="/settings/ai-soar"
                className={linkClass}
                title="AI & SOAR"
              >
                <span className="hidden lg:inline">AI &amp; SOAR</span>
                <span className="lg:hidden">AI</span>
              </NavLink>
            ) : null}

            {showInstanceSettings ? (
              <NavLink
                to="/settings/instance"
                className={linkClass}
                title="Instance settings"
              >
                <span className="hidden lg:inline">Instance settings</span>
                <span className="lg:hidden">IS</span>
              </NavLink>
            ) : null}

            {showDocumentation ? (
              <NavLink
                to="/settings/documentation"
                className={linkClass}
                title="Documentation"
              >
                <span className="hidden lg:inline">Doko docs</span>
                <span className="lg:hidden">DC</span>
              </NavLink>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div className="mt-2 hidden rounded-3xl border border-border bg-background/60 px-4 py-3 shadow-soft lg:block">
        <div className="flex flex-col items-center justify-center gap-1 text-[12px] text-muted-foreground">
          <div className="flex items-center justify-center gap-2">
            <PawPrint className="h-3 w-3" />
            <span>Neko wa doko ?</span>
          </div>

          <a
            href={DOKO_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-medium text-muted-foreground/60 transition hover:text-muted-foreground"
            title="View Doko releases"
            aria-label={`View Doko releases ${DOKO_VERSION}`}
          >
            Doko {DOKO_VERSION}
          </a>
        </div>
      </div>
    </aside>
  );
}