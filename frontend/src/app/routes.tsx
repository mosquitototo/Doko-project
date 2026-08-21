import { lazy, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import Shell from "../components/layout/Shell";
import RequireAnyPerm from "../components/RequireAnyPerm";
import { useMe } from "../contexts/MeContext";
import { getToken } from "../auth/auth";

const Login = lazy(() => import("../pages/Login"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Cases = lazy(() => import("../pages/Cases"));
const CaseDetail = lazy(() => import("../pages/CaseDetail"));
const CaseNew = lazy(() => import("../pages/CaseNew"));
const Alerts = lazy(() => import("../pages/Alerts"));
const AlertDetail = lazy(() => import("../pages/AlertDetail"));
const SettingsUsers = lazy(() => import("../pages/settings/access-control/Users"));
const SettingsRoles = lazy(() => import("../pages/settings/access-control/Roles"));
const RoleEdit = lazy(() => import("../pages/settings/access-control/RoleEdit"));
const RoleNew = RoleEdit;
const SettingsDataModels = lazy(() => import("../pages/settings/DataModels"));
const SettingsCustomers = lazy(() => import("../pages/settings/Customers"));
const SettingsWorkbooks = lazy(() => import("../pages/settings/Workbooks"));
const SettingsReports = lazy(() => import("../pages/settings/Reports"));
const Connectors = lazy(() => import("../pages/settings/Connectors"));
const SettingsCaseManagement = lazy(() => import("../pages/settings/CaseManagement"));
const AutomationRuleEdit = lazy(() => import("../pages/settings/AutomationRuleEdit"));
const Preferences = lazy(() => import("../pages/Preferences"));
const SettingsAudit = lazy(() => import("../pages/settings/access-control/Audit"));
const ResetPassword = lazy(() => import("../pages/settings/access-control/ResetPassword"));
const HuntsPage = lazy(() => import("../pages/Hunts"));
const HuntDetailPage = lazy(() => import("../pages/HuntDetail"));
const ChatbotPage = lazy(() => import("../pages/Chatbot"));
const AIAndSOARSettingsPage = lazy(() => import("../pages/settings/AIAndSOAR"));
const InstanceSettings = lazy(() => import("../pages/settings/InstanceSettings"));
const SearchPage = lazy(() => import("../pages/Search"));
const Documentation = lazy(() => import("../pages/settings/Documentation"));
const DocumentationDetail = lazy(() => import("../pages/settings/DocumentationDetail"));
const Tasks = lazy(() => import("../pages/Tasks"));
const TaskDetail = lazy(() => import("../pages/TaskDetail"));


function RequireAuth() {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}


function RequirePerm({
  any,
  children,
}: {
  any: string[];
  children: ReactNode;
}) {
  const me = useMe();

  return (
    <RequireAnyPerm me={me} any={any}>
      {children}
    </RequireAnyPerm>
  );
}


export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/reset-password", element: <ResetPassword /> },

  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <Shell />,
        children: [
          { index: true, element: <Dashboard /> },

          { path: "cases", element: <RequirePerm any={["case.view"]}><Cases /></RequirePerm> },
          { path: "cases/new", element: <RequirePerm any={["case.add"]}><CaseNew /></RequirePerm> },
          { path: "cases/:id", element: <RequirePerm any={["case.view"]}><CaseDetail /></RequirePerm> },

          { path: "alerts", element: <RequirePerm any={["alert.view"]}><Alerts /></RequirePerm> },
          { path: "alerts/:id", element: <RequirePerm any={["alert.view"]}><AlertDetail /></RequirePerm> },

          { path: "settings/access-control/users", element: <RequirePerm any={["settings.access.users.view"]}><SettingsUsers /></RequirePerm> },
          { path: "settings/access-control/roles", element: <RequirePerm any={["settings.access.roles.view"]}><SettingsRoles /></RequirePerm> },
          { path: "settings/access-control/roles/new", element: <RequirePerm any={["settings.access.roles.manage"]}><RoleNew /></RequirePerm> },
          { path: "settings/access-control/roles/:roleId", element: <RequirePerm any={["settings.access.roles.view"]}><RoleEdit /></RequirePerm> },
          { path: "settings/access-control/audit", element: <RequirePerm any={["settings.access.users.view", "settings.access.roles.view"]}><SettingsAudit /></RequirePerm> },

          { path: "settings/data-models", element: <RequirePerm any={["settings.data_models.view"]}><SettingsDataModels /></RequirePerm> },
          { path: "settings/customers", element: <RequirePerm any={["settings.customers.view"]}><SettingsCustomers /></RequirePerm> },

          { path: "settings/workbooks", element: <RequirePerm any={["settings.workbooks.view"]}><SettingsWorkbooks /></RequirePerm> },
          { path: "settings/reports", element: <RequirePerm any={["settings.reports.view"]}><SettingsReports /></RequirePerm> },
          { path: "settings/connectors", element: <RequirePerm any={["settings.connectors.view"]}><Connectors /></RequirePerm> },

          { path: "settings/case-management", element: <RequirePerm any={["settings.case_management.view"]}><SettingsCaseManagement /></RequirePerm> },
          { path: "settings/case-management/automation-rules/new", element: <RequirePerm any={["settings.case_management.manage"]}><AutomationRuleEdit /></RequirePerm> },
          { path: "settings/case-management/automation-rules/:id", element: <RequirePerm any={["settings.case_management.manage"]}><AutomationRuleEdit /></RequirePerm> },

          { path: "preferences", element: <Preferences /> },

          { path: "hunts", element: <RequirePerm any={["hunt.view"]}><HuntsPage /></RequirePerm> },
          { path: "hunts/:id", element: <RequirePerm any={["hunt.view"]}><HuntDetailPage /></RequirePerm> },

          { path: "chatbot", element: <RequirePerm any={["chat.use"]}><ChatbotPage /></RequirePerm> },

          { path: "settings/ai-soar", element: <RequirePerm any={["settings.chat.view", "settings.chat.manage", "chat.template.manage"]}><AIAndSOARSettingsPage /></RequirePerm> },

          { path: "settings/instance", element: <RequirePerm any={["settings.instance.manage"]}><InstanceSettings /></RequirePerm> },

          { path: "search", element: <RequirePerm any={["case.view", "alert.view", "hunt.view"]}><SearchPage /></RequirePerm> },

          { path: "settings/documentation", element: <RequirePerm any={["settings.documentation.view"]}><Documentation /></RequirePerm>, },
          { path: "settings/documentation/:slug", element: <RequirePerm any={["settings.documentation.view"]}><DocumentationDetail /></RequirePerm>, },

          { path: "tasks", element: <RequirePerm any={["task.view", "task.manage"]}><Tasks /></RequirePerm> },
          { path: "tasks/:id", element: <RequirePerm any={["task.view", "task.manage"]}><TaskDetail /></RequirePerm> },

        ],
      },
    ],
  },


  { path: "*", element: <Navigate to="/" replace /> },
]);
