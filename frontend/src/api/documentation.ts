import soarAdminGuide from "../content/docs/admin_soar_invest_template_configuration_docs.md?raw";
import apiAutomationGuide from "../content/docs/doko_api_automation_documentation.md?raw";
import AutomationRulesGuide from "../content/docs/admin_automation_rules_documentation.md?raw";
import ConnectorsGuide from "../content/docs/admin_connectors_documentation.md?raw";
import CaseReportsGuide from "../content/docs/admin_case_reports_documentation.md?raw";
import InstanceSettingsGuide from "../content/docs/admin_instance_settings_documentation.md?raw";

export type DocumentationPage = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
};

export const DOCUMENTATION_PAGES: DocumentationPage[] = [
  {
    slug: "administrator-instance-settings",
    title: "Instance Settings",
    category: "Administration",
    summary:
      "Configure the outbound proxy, backups, audit exports and Splunk HEC.",
    content: InstanceSettingsGuide,
  },
  {
    slug: "administrator-soar-configuration-guide",
    title: "LLM, SOAR & Investigation Templates",
    category: "Administration",
    summary:
      "Configure LLM and SOAR providers and investigation templates.",
    content: soarAdminGuide, 
  },
  {
    slug: "api-automation-guide",
    title: "API & Automation Guide",
    category: "Administration",
    summary:
      "Authenticate, use the Doko API and build automation workflows.",
    content: apiAutomationGuide,
  },
  {
    slug: "administrator-automation-rule",
    title: "Automation Rules",
    category: "Administration",
    summary:
      "Configure triggers, conditions and actions for alerts, cases and hunts.",
    content: AutomationRulesGuide,
  },
  {
    slug: "administrator-connectors",
    title: "Connectors",
    category: "Administration",
    summary:
      "Configure allowlisted HTTP connectors and reusable endpoints.",
    content: ConnectorsGuide,
  },
  {
    slug: "administrator-case-reports",
    title: "Case Reports",
    category: "Administration",
    summary:
      "Create HTML and CSS templates for PDF case reports.",
    content: CaseReportsGuide,
  },
];

export function getDocumentationPage(slug: string) {
  return DOCUMENTATION_PAGES.find((page) => page.slug === slug) ?? null;
}

export function getDocumentationCategories() {
  return Array.from(new Set(DOCUMENTATION_PAGES.map((page) => page.category)));
}
