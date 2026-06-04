import soarAdminGuide from "../content/docs/admin_soar_invest_template_configuration_docs.md?raw";
import apiAutomationGuide from "../content/docs/doko_api_automation_documentation.md?raw";
import AutomationRulesGuide from "../content/docs/admin_automation_rules_documentation.md?raw";
import ConnectorsGuide from "../content/docs/admin_connectors_documentation.md?raw";
import CaseReportsGuide from "../content/docs/admin_case_reports_documentation.md?raw";

export type DocumentationPage = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
};

export const DOCUMENTATION_PAGES: DocumentationPage[] = [
  {
    slug: "administrator-soar-configuration-guide",
    title: "SOAR/LLM & Investigation Templates",
    category: "Administration",
    summary:
      "Configure SOAR providers, LLM provider and investigation templates.",
    content: soarAdminGuide, 
  },
  {
    slug: "api-automation-guide",
    title: "API Automation Guide",
    category: "Administration",
    summary:
      "How to use Doko API.",
    content: apiAutomationGuide,
  },
  {
    slug: "administrator-automation-rule",
    title: "Automation rules Guide",
    category: "Administration",
    summary:
      "How to configure automation rules.",
    content: AutomationRulesGuide,
  },
  {
    slug: "administrator-connectors",
    title: "Connectors configuration Guide",
    category: "Administration",
    summary:
      "How to configure connectors.",
    content: ConnectorsGuide,
  },
  {
    slug: "administrator-case-reports",
    title: "Case reports Guide",
    category: "Administration",
    summary:
      "How to make a case report.",
    content: CaseReportsGuide,
  },
];

export function getDocumentationPage(slug: string) {
  return DOCUMENTATION_PAGES.find((page) => page.slug === slug) ?? null;
}

export function getDocumentationCategories() {
  return Array.from(new Set(DOCUMENTATION_PAGES.map((page) => page.category)));
}
