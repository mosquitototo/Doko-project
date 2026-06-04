import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import Shell from "../components/layout/Shell";
import Login from "../pages/Login";
import Dashboard from "../pages/Dashboard";
import Cases from "../pages/Cases";
import CaseDetail from "../pages/CaseDetail";
import CaseNew from "../pages/CaseNew";
import Alerts from "../pages/Alerts";
import AlertDetail from "../pages/AlertDetail";
import SettingsUsers from "../pages/settings/access-control/Users";
import SettingsRoles from "../pages/settings/access-control/Roles";
import RoleEdit from "../pages/settings/access-control/RoleEdit";
import RoleNew from "../pages/settings/access-control/RoleEdit";
import SettingsDataModels from "../pages/settings/DataModels";
import SettingsCustomers from "../pages/settings/Customers";
import SettingsWorkbooks from "../pages/settings/Workbooks";
import SettingsReports from "../pages/settings/Reports";
import Connectors from "../pages/settings/Connectors";
import SettingsCaseManagement from "../pages/settings/CaseManagement";
import AutomationRuleEdit from "../pages/settings/AutomationRuleEdit";
import Preferences from "../pages/Preferences";
import SettingsAudit from "../pages/settings/access-control/Audit";
import ResetPassword from "../pages/settings/access-control/ResetPassword";
import HuntsPage from "../pages/Hunts";
import HuntDetailPage from "../pages/HuntDetail";
import ChatbotPage from "../pages/Chatbot";
import AIAndSOARSettingsPage from "../pages/settings/AIAndSOAR";
import InstanceSettings from "../pages/settings/InstanceSettings";
import SearchPage from "../pages/Search"; 
import Documentation from "../pages/settings/Documentation";
import DocumentationDetail from "../pages/settings/DocumentationDetail";
import Tasks from "../pages/Tasks";
import TaskDetail from "../pages/TaskDetail";
import RequireAnyPerm from "../components/RequireAnyPerm";
import { useMe } from "../contexts/MeContext";
import { getToken } from "../auth/auth";



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
  children: React.ReactNode;
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

          { path: "tasks", element: <RequirePerm any={["task.view"]}><Tasks /></RequirePerm> },
          { path: "tasks/:id", element: <RequirePerm any={["task.view"]}><TaskDetail /></RequirePerm> },

        ],
      },
    ],
  },


  { path: "*", element: <Navigate to="/" replace /> },
]);