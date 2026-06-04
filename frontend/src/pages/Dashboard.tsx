import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Tooltip,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Filter,
  LayoutGrid,
  RotateCcw,
  Settings2,
  X,
  GripVertical,
  ActionButton,
} from "../components/ui/IconButton";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import SeverityBadge from "../components/ui/SeverityBadge";
import {
  fetchDashboard,
  fetchDashboardPreferences,
  resetDashboardPreferences,
  updateDashboardPreferences,
  type DashboardQueryParams,
} from "../api/dashboard";
import { listCustomers, type Customer } from "../api/settingsCustomers";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtAxisLabel(value: string) {
  if (!value) return "";
  if (value.length === 10) {
    try {
      const d = new Date(`${value}T00:00:00`);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}`;
    } catch {
      return value;
    }
  }
  return value;
}

type Row = { key: string | null; label: string; value: number };
type CasesDay = { date: string; created: number; closed: number };
type AlertsDay = { date: string; created: number };

type WidgetMeta = {
  id: string;
  label: string;
  kind: "kpi" | "chart" | "list" | "table";
};

const PIE_COLORS = [
  "#4f6fa5", // blue muted
  "#b04a4a", // red muted
  "#4f8a6b", // green muted
  "#b38a3e", // amber muted
  "#7a5ea8", // purple muted
  "#3f8f94", // cyan muted
  "#a86a3a", // orange muted
  "#6f9a3c", // lime muted
  "#a85c7c", // pink muted
  "#5a66a8", // indigo muted
];

const PERIOD_OPTIONS = [
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
  { value: "since", label: "Since date" },
  { value: "between", label: "Between dates" },
  { value: "all", label: "All the time" },
] as const;

function reorderWidgets(items: string[], fromId: string, toId: string) {
  if (fromId === toId) return items;
  const next = [...items];
  const fromIndex = next.indexOf(fromId);
  const toIndex = next.indexOf(toId);
  if (fromIndex === -1 || toIndex === -1) return items;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function WidgetShell({
  widgetId,
  children,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
}: {
  widgetId: string;
  children: React.ReactNode;
  onRemove: () => void;
  onDragStart: (widgetId: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (widgetId: string) => void;
  isDragging: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(widgetId)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={() => onDrop(widgetId)}
      className={`group relative transition ${
        isDragging ? "opacity-40" : "opacity-100"
      }`}
    >
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">

        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-border/60 bg-background/85 text-muted-foreground opacity-0 shadow-sm transition hover:border-border hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Remove widget"
          title="Remove widget"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div
          className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-xl border border-border bg-background/90 text-muted-foreground shadow-sm"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>


      </div>

      {children}
    </div>
  );
}

function ChartCardHeader({
  title,
  subtitle,
  total,
}: {
  title: string;
  subtitle?: string;
  total?: string | number;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 pr-24">
      <div>
        <div className="text-base font-semibold text-foreground">{title}</div>
        {subtitle ? (
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>

      {total !== undefined ? (
        <div className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {total}
        </div>
      ) : null}
    </div>
  );
}

function PieCard({
  title,
  rows,
  subtitle,
}: {
  title: string;
  rows: Row[];
  subtitle?: string;
}) {
  const data = useMemo(
    () => (rows ?? []).filter((r) => (r.value || 0) > 0),
    [rows]
  );
  const total = useMemo(
    () => data.reduce((s, r) => s + (r.value || 0), 0),
    [data]
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <Card className="p-5">
      <ChartCardHeader title={title} subtitle={subtitle} total={total} />

      {data.length === 0 ? (
        <div className="py-8 text-sm text-muted-foreground">No data.</div>
      ) : (
        <div className="grid items-center gap-5 xl:grid-cols-[minmax(0,220px)_1fr]">
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="58%"
                  outerRadius="84%"
                  isAnimationActive={false}
                  stroke="none"
                >
                  {data.map((_, idx) => {
                    const isHovered = hoveredIndex === idx;

                    return (
                      <Cell
                        key={idx}
                        fill={PIE_COLORS[idx % PIE_COLORS.length]}
                        strokeWidth={isHovered ? 4 : 0}
                        style={{
                          filter: isHovered ? "brightness(1.08)" : "none",
                          cursor: "pointer",
                          transition: "filter 120ms ease, stroke-width 120ms ease",
                        }}
                        onMouseEnter={() => setHoveredIndex(idx)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => {
                    const v = Number(value || 0);
                    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                    return [`${v} • ${pct}%`, String(name)];
                  }}
                  contentStyle={{
                    borderRadius: "10px",
                    border: "1px solid rgba(148,163,184,0.14)",
                    boxShadow: "0 8px 20px rgba(2,6,23,0.08)",
                    background: "rgba(255,255,255,0.96)",
                    padding: "5px 7px",
                    fontSize: "11px",
                    lineHeight: 1.15,
                  }}
                  itemStyle={{
                    fontSize: "11px",
                    padding: 0,
                    margin: 0,
                  }}
                  labelStyle={{
                    fontSize: "10px",
                    marginBottom: "2px",
                  }}
                  wrapperStyle={{
                    outline: "none",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2.5">
            {data
              .slice()
              .sort((a, b) => (b.value || 0) - (a.value || 0))
              .slice(0, 8)
              .map((r, idx) => {
                const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
                return (
                  <div
                    key={String(r.key) + r.label}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/70 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: PIE_COLORS[idx % PIE_COLORS.length],
                        }}
                      />
                      <div className="truncate text-sm text-foreground">
                        {r.label}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      {r.value} • {pct}%
                    </div>
                  </div>
                );
              })}

            {data.length > 8 ? (
              <div className="pt-1 text-[11px] text-muted-foreground">
                + {data.length - 8} more…
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}

function FullWidthBarCases({
  rows,
  subtitle,
}: {
  rows: CasesDay[];
  subtitle: string;
}) {
  const data = useMemo(() => (rows ?? []).slice(), [rows]);
  const totalCreated = useMemo(
    () => data.reduce((s, r) => s + (r.created || 0), 0),
    [data]
  );
  const totalClosed = useMemo(
    () => data.reduce((s, r) => s + (r.closed || 0), 0),
    [data]
  );

  return (
    <Card className="p-5">
      <ChartCardHeader
        title="Cases created vs closed"
        subtitle={subtitle}
        total={`created ${totalCreated} • closed ${totalClosed}`}
      />

      {data.length === 0 ? (
        <div className="py-8 text-sm text-muted-foreground">No data.</div>
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap="28%">
              <XAxis
                dataKey="date"
                tickFormatter={fmtAxisLabel}
                interval="preserveStartEnd"
                minTickGap={25}
                fontSize={10}
                stroke="currentColor"
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis
                allowDecimals={false}
                stroke="currentColor"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => (val === 0 ? "" : val)}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
                contentStyle={{
                  borderRadius: "16px",
                  border: "1px solid rgba(148,163,184,0.2)",
                  boxShadow: "0 20px 50px rgba(2,6,23,0.12)",
                  background: "rgba(255,255,255,0.98)",
                  fontSize: "12px",
                  color: "#121d38",
                }}
              />
              <Bar
                dataKey="created"
                name="Created"
                fill="#dc2626"
                radius={[6, 6, 0, 0]}
                barSize={12}
              />
              <Bar
                dataKey="closed"
                name="Closed"
                fill="#16a34a"
                radius={[6, 6, 0, 0]}
                barSize={12}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function FullWidthBarAlerts({
  rows,
  subtitle,
}: {
  rows: AlertsDay[];
  subtitle: string;
}) {
  const data = useMemo(() => (rows ?? []).slice(), [rows]);
  const total = useMemo(
    () => data.reduce((s, r) => s + (r.created || 0), 0),
    [data]
  );

  return (
    <Card className="p-5">
      <ChartCardHeader
        title="Raised alerts"
        subtitle={subtitle}
        total={total}
      />

      {data.length === 0 ? (
        <div className="py-8 text-sm text-muted-foreground">No data.</div>
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap="35%">
              <XAxis
                dataKey="date"
                tickFormatter={fmtAxisLabel}
                interval="preserveStartEnd"
                minTickGap={25}
                fontSize={10}
                stroke="currentColor"
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis
                allowDecimals={false}
                stroke="currentColor"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => (val === 0 ? "" : val)}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
                contentStyle={{
                  borderRadius: "16px",
                  border: "1px solid rgba(148,163,184,0.2)",
                  boxShadow: "0 20px 50px rgba(2,6,23,0.12)",
                  background: "rgba(255,255,255,0.98)",
                  fontSize: "12px",
                  color: "#121d38",
                }}
                formatter={(value: any) => [Number(value || 0), "Generated"]}
              />
              <Bar
                dataKey="created"
                fill="#2563eb"
                radius={[6, 6, 0, 0]}
                barSize={14}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function getSeverityMiniBarColor(label?: string | null) {
  const value = String(label || "").trim().toLowerCase();

  switch (value) {
    case "critical":
      return "#dc2626";
    case "high":
      return "#ea580c";
    case "medium":
      return "#d97706";
    case "low":
      return "#2563eb";
    case "info":
    case "informational":
      return "#0891b2";
    default:
      return "rgba(59,130,246,0.75)";
  }
}

function getSeverityOrder(label?: string | null) {
  const value = String(label || "").trim().toLowerCase();

  switch (value) {
    case "info":
    case "informational":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
    default:
      return 99;
  }
}

function SeverityMiniBars({ rows }: { rows?: Row[] }) {
  const data = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => (r.value || 0) > 0)
        .slice()
        .sort((a, b) => getSeverityOrder(a.label) - getSeverityOrder(b.label)),
    [rows]
  );

  if (!data.length) return null;

  return (
    <div className="mt-3 flex items-end justify-end gap-1.5">
      {data.map((r) => {
        const color = getSeverityMiniBarColor(r.label);

        return (
          <div
            key={`${r.key}-${r.label}`}
            className="group relative flex items-end"
            title={`${r.label}: ${r.value}`}
          >
            <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              {r.value}
            </div>

            <div
              className="w-2 rounded-full transition-opacity group-hover:opacity-100"
              style={{
                height: `${Math.max(6, Math.min(24, r.value * 6))}px`,
                backgroundColor: color,
                opacity: 0.9,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}


function KpiCard({
  title,
  value,
  subtitle,
  severityRows,
}: {
  title: string;
  value: number | string;
  subtitle: string;
  severityRows?: Row[];
}) {
  return (
    <Card className="p-5">
      <div className="flex min-h-[116px] flex-col">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          {value}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{subtitle}</div>
        <div className="mt-auto">
          <SeverityMiniBars rows={severityRows} />
        </div>
      </div>
    </Card>
  );
}

function SlaTable({ rows }: { rows: any[] }) {
  return (
    <Card className="p-5">
      <ChartCardHeader
        title="SLA by customer"
        subtitle="Closed alerts in the selected period"
        total={rows.length}
      />

      {rows.length === 0 ? (
        <div className="py-8 text-sm text-muted-foreground">
          No SLA data available.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">SLA</th>
                <th className="px-3 py-2 font-medium">Closed</th>
                <th className="px-3 py-2 font-medium">Within SLA</th>
                <th className="px-3 py-2 font-medium">Breached</th>
                <th className="px-3 py-2 font-medium">Rate</th>
                <th className="px-3 py-2 font-medium">Avg resolution</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.customer_id}-${row.customer_name}`}
                  className="border-b border-border/70"
                >
                  <td className="px-3 py-3 text-foreground">{row.customer_name}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.severity || "—"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.sla_hours}h
                  </td>
                  <td className="px-3 py-3 text-foreground">{row.closed_count}</td>
                  <td className="px-3 py-3 text-foreground">
                    {row.within_sla_count}
                  </td>
                  <td className="px-3 py-3 text-foreground">
                    {row.breached_count}
                  </td>
                  <td className="px-3 py-3 text-foreground">
                    {row.sla_rate ?? "—"}%
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.avg_resolution_hours ?? "—"}h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function normalizeDashboard(raw: any) {
  const safe = raw && typeof raw === "object" ? raw : {};

  return {
    scope: safe.scope ?? {
      customer: "",
      period: "last_90d",
      date_from: "",
      date_to: "",
    },
    allowed_customers: Array.isArray(safe.allowed_customers)
      ? safe.allowed_customers
      : [],
    available_widgets: Array.isArray(safe.available_widgets)
      ? safe.available_widgets
      : [],
    preferences:
      safe.preferences && typeof safe.preferences === "object"
        ? safe.preferences
        : { widgets: [], default_widgets: [] },
    kpis: {
      cases_open: Number(safe?.kpis?.cases_open ?? 0),
      alerts_open: Number(safe?.kpis?.alerts_open ?? 0),
      hunts_open: Number(safe?.kpis?.hunts_open ?? 0),
      cases_closed_period: Number(safe?.kpis?.cases_closed_period ?? 0),
      alerts_closed_period: Number(safe?.kpis?.alerts_closed_period ?? 0),
      cases_archived_period: Number(safe?.kpis?.cases_archived_period ?? 0),
      tpwi_cases_period: Number(safe?.kpis?.tpwi_cases_period ?? 0),
      alert_fp_rate: safe?.kpis?.alert_fp_rate ?? {
        false_positive_count: 0,
        true_positive_count: 0,
        qualified_total: 0,
        rate: null,
      },
      case_fp_rate: safe?.kpis?.case_fp_rate ?? {
        false_positive_count: 0,
        true_positive_count: 0,
        qualified_total: 0,
        rate: null,
      },
      open_cases_by_severity: Array.isArray(safe?.kpis?.open_cases_by_severity)
        ? safe.kpis.open_cases_by_severity
        : [],
      open_alerts_by_severity: Array.isArray(safe?.kpis?.open_alerts_by_severity)
        ? safe.kpis.open_alerts_by_severity
        : [],
    },
    sla: {
      global:
        safe?.sla?.global && typeof safe.sla.global === "object"
          ? safe.sla.global
          : {
              configured_customers: 0,
              closed_count: 0,
              within_sla_count: 0,
              breached_count: 0,
              sla_rate: null,
              avg_resolution_hours: null,
            },
      by_customer: Array.isArray(safe?.sla?.by_customer)
        ? safe.sla.by_customer
        : [],
    },
    charts: {
      cases_created_closed_series: Array.isArray(
        safe?.charts?.cases_created_closed_series
      )
        ? safe.charts.cases_created_closed_series
        : [],
      alerts_created_series: Array.isArray(safe?.charts?.alerts_created_series)
        ? safe.charts.alerts_created_series
        : [],
      cases_by_severity_period: Array.isArray(
        safe?.charts?.cases_by_severity_period
      )
        ? safe.charts.cases_by_severity_period
        : [],
      open_cases_by_customer: Array.isArray(
        safe?.charts?.open_cases_by_customer
      )
        ? safe.charts.open_cases_by_customer
        : [],
      open_alerts_by_customer: Array.isArray(
        safe?.charts?.open_alerts_by_customer
      )
        ? safe.charts.open_alerts_by_customer
        : [],
      open_hunts_by_customer: Array.isArray(
        safe?.charts?.open_hunts_by_customer
      )
        ? safe.charts.open_hunts_by_customer
        : [],
      alerts_created_by_customer_period: Array.isArray(
        safe?.charts?.alerts_created_by_customer_period
      )
        ? safe.charts.alerts_created_by_customer_period
        : [],
      cases_created_by_customer_period: Array.isArray(
        safe?.charts?.cases_created_by_customer_period
      )
        ? safe.charts.cases_created_by_customer_period
        : [],
      tpwi_cases_by_customer_period: Array.isArray(
        safe?.charts?.tpwi_cases_by_customer_period
      )
        ? safe.charts.tpwi_cases_by_customer_period
        : [],
      cases_by_classification_period: Array.isArray(
        safe?.charts?.cases_by_classification_period
      )
        ? safe.charts.cases_by_classification_period
        : [],
      cases_by_outcome_period: Array.isArray(
        safe?.charts?.cases_by_outcome_period
      )
        ? safe.charts.cases_by_outcome_period
        : [],
    },
    personal: {
      my_open_cases: Array.isArray(safe?.personal?.my_open_cases)
        ? safe.personal.my_open_cases
        : [],
    },
    latest_cases: Array.isArray(safe.latest_cases) ? safe.latest_cases : [],
  };
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [period, setPeriod] =
    useState<DashboardQueryParams["period"]>("last_90d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [widgetIds, setWidgetIds] = useState<string[]>([]);
  const [defaultWidgetIds, setDefaultWidgetIds] = useState<string[]>([]);
  const [availableWidgets, setAvailableWidgets] = useState<WidgetMeta[]>([]);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const handleDragEnd = () => {
    setDraggedWidgetId(null);
  };

  useEffect(() => {
    listCustomers({ include_inactive: false })
      .then((r) => setCustomers(r.results ?? []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchDashboardPreferences()
      .then((prefs) => {
        if (cancelled) return;
        const available = Array.isArray(prefs?.available_widgets)
          ? prefs.available_widgets
          : [];
        const widgets = Array.isArray(prefs?.widgets) ? prefs.widgets : [];
        const defaults = Array.isArray(prefs?.default_widgets)
          ? prefs.default_widgets
          : [];

        setAvailableWidgets(available);
        setWidgetIds(widgets);
        setDefaultWidgetIds(defaults);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableWidgets([]);
        setWidgetIds([]);
        setDefaultWidgetIds([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);


  useEffect(() => {
    let cancelled = false;

    if (period === "since" && !dateFrom) {
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    if (period === "between" && (!dateFrom || !dateTo)) {
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    if (period === "between" && dateFrom && dateTo && dateFrom > dateTo) {
      setError("The selected period is invalid: start date must be before end date.");
      setData(normalizeDashboard(null));
      return () => {
        cancelled = true;
      };
    }

    setError(null);


    fetchDashboard({
      customer: customerId || undefined,
      period,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    })
      .then((d) => {
        if (cancelled) return;
        const normalized = normalizeDashboard(d);
        setData(normalized);

        if (!widgetIds.length && Array.isArray(normalized.preferences?.widgets)) {
          setWidgetIds(normalized.preferences.widgets);
        }
        if (
          !defaultWidgetIds.length &&
          Array.isArray(normalized.preferences?.default_widgets)
        ) {
          setDefaultWidgetIds(normalized.preferences.default_widgets);
        }
        if (
          !availableWidgets.length &&
          Array.isArray(normalized.available_widgets)
        ) {
          setAvailableWidgets(normalized.available_widgets);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const msg =
          e?.response?.data?.detail
            ? String(e.response.data.detail)
            : e?.response?.status
            ? `API error (${e.response.status})`
            : "Network error";
        setError(msg);
        setData(normalizeDashboard(null));
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, period, dateFrom, dateTo]);

  const persistWidgets = async (next: string[]) => {
    setSavingLayout(true);
    try {
      const res = await updateDashboardPreferences({ widgets: next });
      const widgets = Array.isArray(res?.widgets) ? res.widgets : next;
      setWidgetIds(widgets);
      if (Array.isArray(res?.default_widgets)) {
        setDefaultWidgetIds(res.default_widgets);
      }
      if (Array.isArray(res?.available_widgets)) {
        setAvailableWidgets(res.available_widgets);
      }
    } finally {
      setSavingLayout(false);
    }
  };


  const toggleWidget = async (widgetId: string) => {
    const has = widgetIds.includes(widgetId);
    const next = has
      ? widgetIds.filter((id) => id !== widgetId)
      : [...widgetIds, widgetId];
    await persistWidgets(next);
  };

  const removeWidget = async (widgetId: string) => {
    const next = widgetIds.filter((id) => id !== widgetId);
    await persistWidgets(next);
  };

  const handleResetWidgets = async () => {
    setSavingLayout(true);
    try {
      const res = await resetDashboardPreferences();
      const widgets = Array.isArray(res?.widgets) ? res.widgets : [];
      const defaults = Array.isArray(res?.default_widgets)
        ? res.default_widgets
        : [];
      const available = Array.isArray(res?.available_widgets)
        ? res.available_widgets
        : [];

      setWidgetIds(widgets);
      setDefaultWidgetIds(defaults);
      setAvailableWidgets(available);
    } finally {
      setSavingLayout(false);
    }
  };

  const handleDropWidget = async (targetWidgetId: string) => {
    if (!draggedWidgetId || draggedWidgetId === targetWidgetId) return;
    const next = reorderWidgets(enabledWidgetIds, draggedWidgetId, targetWidgetId);
    setDraggedWidgetId(null);
    await persistWidgets(next);
  };

  const periodLabel = useMemo(() => {
    const found = PERIOD_OPTIONS.find((x) => x.value === period);
    if (!found) return "Selected period";

    if (period === "since" && dateFrom) {
      return `Since ${dateFrom}`;
    }
    if (period === "between" && dateFrom && dateTo) {
      return `${dateFrom} → ${dateTo}`;
    }
    return found.label;
  }, [period, dateFrom, dateTo]);


  const periodValidationError = useMemo(() => {
    if (period !== "between") return null;
    if (!dateFrom || !dateTo) return null;
    if (dateFrom > dateTo) {
      return "The selected period is invalid: start date must be before end date.";
    }
    return null;
  }, [period, dateFrom, dateTo]);


  const widgetMetaMap = useMemo(() => {
    const m = new Map<string, WidgetMeta>();
    for (const item of availableWidgets) {
      m.set(item.id, item);
    }
    return m;
  }, [availableWidgets]);

  const enabledWidgetIds = useMemo(() => {
    const source = widgetIds.length ? widgetIds : defaultWidgetIds;
    return source.filter((id) => widgetMetaMap.has(id) || !availableWidgets.length);
  }, [widgetIds, defaultWidgetIds, widgetMetaMap, availableWidgets.length]);

  if (!data) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-soft">
          Loading dashboard…
        </div>
      </div>
    );
  }

  const allowedIds: Set<string> | null = (() => {
    const ac = data?.allowed_customers;
    if (!Array.isArray(ac)) return null;
    const s = new Set<string>();
    for (const x of ac) {
      const id = x?.id != null ? String(x.id) : "";
      if (id) s.add(id);
    }
    return s;
  })();

  const k = data.kpis;
  const charts = data.charts;
  const sla = data.sla;

  const renderWidget = (widgetId: string) => {
    switch (widgetId) {
      case "cases_open":
        return (
          <KpiCard
            title="Cases still opened"
            value={k.cases_open}
            subtitle="Current backlog"
            severityRows={k.open_cases_by_severity ?? []}
          />
        );

      case "alerts_open":
        return (
          <KpiCard
            title="Alerts still opened"
            value={k.alerts_open}
            subtitle="Current backlog"
            severityRows={k.open_alerts_by_severity ?? []}
          />
        );

      case "hunts_open":
        return (
          <KpiCard
            title="Hunts still opened"
            value={k.hunts_open}
            subtitle="Current backlog"
          />
        );

      case "cases_closed_period":
        return (
          <KpiCard
            title="Cases closed"
            value={k.cases_closed_period}
            subtitle={periodLabel}
          />
        );

      case "alerts_closed_period":
        return (
          <KpiCard
            title="Alerts closed"
            value={k.alerts_closed_period}
            subtitle={periodLabel}
          />
        );

      case "cases_archived_period":
        return (
          <KpiCard
            title="Cases archived"
            value={k.cases_archived_period}
            subtitle={periodLabel}
          />
        );

      case "tpwi_cases_period":
        return (
          <KpiCard
            title="TP with impact cases"
            value={k.tpwi_cases_period}
            subtitle={periodLabel}
          />
        );

      case "alert_fp_rate":
        return (
          <KpiCard
            title="Alert false positive rate"
            value={
              k.alert_fp_rate?.rate != null ? `${k.alert_fp_rate.rate}%` : "—"
            }
            subtitle={`FP: ${k.alert_fp_rate?.false_positive_count ?? 0} • Qualified: ${
              k.alert_fp_rate?.qualified_total ?? 0
            }`}
          />
        );

      case "case_fp_rate":
        return (
          <KpiCard
            title="Case false positive rate"
            value={
              k.case_fp_rate?.rate != null ? `${k.case_fp_rate.rate}%` : "—"
            }
            subtitle={`FP: ${k.case_fp_rate?.false_positive_count ?? 0} • Qualified: ${
              k.case_fp_rate?.qualified_total ?? 0
            }`}
          />
        );

      case "sla_global":
        return (
          <KpiCard
            title="Global SLA"
            value={
              sla.global?.sla_rate != null ? `${sla.global.sla_rate}%` : "—"
            }
            subtitle={`Closed alerts: ${sla.global?.closed_count ?? 0} • Avg resolution: ${
              sla.global?.avg_resolution_hours ?? "—"
            }h`}
          />
        );

      case "cases_created_closed_series":
        return (
          <FullWidthBarCases
            rows={charts.cases_created_closed_series ?? []}
            subtitle={periodLabel}
          />
        );

      case "alerts_created_series":
        return (
          <FullWidthBarAlerts
            rows={charts.alerts_created_series ?? []}
            subtitle={periodLabel}
          />
        );

      case "cases_by_severity_period":
        return (
          <PieCard
            title="Cases by severity"
            rows={charts.cases_by_severity_period ?? []}
            subtitle={periodLabel}
          />
        );

      case "cases_by_classification_period":
        return (
          <PieCard
            title="Cases by classification"
            rows={charts.cases_by_classification_period ?? []}
            subtitle={periodLabel}
          />
        );

      case "cases_by_outcome_period":
        return (
          <PieCard
            title="Cases by outcome"
            rows={charts.cases_by_outcome_period ?? []}
            subtitle={periodLabel}
          />
        );

      case "open_cases_by_customer":
        return (
          <PieCard
            title="Open cases by customer"
            rows={charts.open_cases_by_customer ?? []}
            subtitle="Current backlog"
          />
        );

      case "open_alerts_by_customer":
        return (
          <PieCard
            title="Open alerts by customer"
            rows={charts.open_alerts_by_customer ?? []}
            subtitle="Current backlog"
          />
        );

      case "open_hunts_by_customer":
        return (
          <PieCard
            title="Open hunts by customer"
            rows={charts.open_hunts_by_customer ?? []}
            subtitle="Current backlog"
          />
        );

      case "cases_created_by_customer_period":
        return (
          <PieCard
            title="Cases created by customer"
            rows={charts.cases_created_by_customer_period ?? []}
            subtitle={periodLabel}
          />
        );

      case "alerts_created_by_customer_period":
        return (
          <PieCard
            title="Alerts created by customer"
            rows={charts.alerts_created_by_customer_period ?? []}
            subtitle={periodLabel}
          />
        );

      case "tpwi_cases_by_customer_period":
        return (
          <PieCard
            title="TP with impact by customer"
            rows={charts.tpwi_cases_by_customer_period ?? []}
            subtitle={periodLabel}
          />
        );

      case "sla_by_customer":
        return <SlaTable rows={sla.by_customer ?? []} />;

      case "my_open_cases":
        return (
          <Card className="p-5">
            <ChartCardHeader
              title="My open cases"
              subtitle="Assigned cases currently in progress"
              total={data.personal.my_open_cases?.length ?? 0}
            />

            <div className="divide-y divide-border">
              {(data.personal.my_open_cases ?? []).length === 0 ? (
                <div className="py-8 text-sm text-muted-foreground">
                  No assigned open case.
                </div>
              ) : (
                data.personal.my_open_cases.map((e: any) => (
                  <Link
                    key={e.id}
                    to={`/cases/${e.id}`}
                    className="flex items-center justify-between gap-4 py-4 transition hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <div className="mb-2 truncate font-medium text-foreground">
                        {e.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge status={e.status} />
                        <SeverityBadge value={e.severity} />
                        <span>•</span>
                        <span className="truncate">{e.customer__name || "—"}</span>
                        <span>•</span>
                        <span className="italic">{formatDate(e.updated_at)}</span>
                      </div>
                    </div>

                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))
              )}
            </div>
          </Card>
        );

      case "recent_cases":
        return (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3 pr-24">
              <div>
                <div className="text-lg font-semibold text-foreground">
                  Recent cases
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Latest cases visible in your scope
                </div>
              </div>

              <Link to="/cases">
                <ActionButton
                  iconOnly={false}
                  title="Display all"
                  label="Display all"
                  variant="secondary"
                  className="h-10"
                />
              </Link>
            </div>

            <div className="divide-y divide-border">
              {(data.latest_cases ?? []).length === 0 ? (
                <div className="py-8 text-sm text-muted-foreground">
                  No case yet.
                </div>
              ) : (
                data.latest_cases.map((e: any) => (
                  <Link
                    key={e.id}
                    to={`/cases/${e.id}`}
                    className="flex items-center justify-between gap-4 py-4 transition hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <div className="mb-2 truncate font-medium text-foreground">
                        {e.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge status={e.status} />
                        <SeverityBadge value={e.severity} />
                        <span>•</span>
                        <span className="truncate">{e.customer__name || "—"}</span>
                        <span>•</span>
                        <span className="italic">{formatDate(e.updated_at)}</span>
                      </div>
                    </div>

                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))
              )}
            </div>
          </Card>
        );

      default:
        return null;
    }
  };

  const kpiWidgets = enabledWidgetIds.filter((id) =>
    [
      "cases_open",
      "alerts_open",
      "hunts_open",
      "cases_closed_period",
      "alerts_closed_period",
      "cases_archived_period",
      "tpwi_cases_period",
      "alert_fp_rate",
      "case_fp_rate",
      "sla_global",
    ].includes(id)
  );

  const otherWidgets = enabledWidgetIds.filter((id) => !kpiWidgets.includes(id));

  const renderWrappedWidget = (widgetId: string) => (
    <WidgetShell
      key={widgetId}
      widgetId={widgetId}
      onRemove={() => removeWidget(widgetId)}
      onDragStart={setDraggedWidgetId}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropWidget}
      isDragging={draggedWidgetId === widgetId}
    >
      {renderWidget(widgetId)}
    </WidgetShell>
  );

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            Dashboard
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Indicators across your SOC activity window.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-10 items-center gap-2 rounded-2xl border border-border bg-card px-3 shadow-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              className="border-none bg-transparent pr-2 text-sm text-foreground outline-none"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">All customers</option>
              {customers
                .filter((c) => c.is_active)
                .filter((c) => (allowedIds ? allowedIds.has(String(c.id)) : true))
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="inline-flex h-10 items-center gap-2 rounded-2xl border border-border bg-card px-3 shadow-sm">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            <select
              className="border-none bg-transparent pr-2 text-sm text-foreground outline-none"
              value={period}
              onChange={(e) =>
                setPeriod(e.target.value as DashboardQueryParams["period"])
              }
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {period === "since" || period === "between" ? (
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none shadow-sm"
            />
          ) : null}

          {period === "between" ? (
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 rounded-2xl border border-border bg-card px-3 text-sm text-foreground outline-none shadow-sm"
            />
          ) : null}

          {periodValidationError ? (
            <div className="w-full text-right text-xs text-destructive">
              {periodValidationError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setWidgetsOpen((v) => !v)}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-border bg-card px-3 text-sm text-foreground shadow-sm transition hover:bg-accent/40"
          >
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Widgets
          </button>

          <button
            type="button"
            onClick={handleResetWidgets}
            disabled={savingLayout}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-border bg-card px-3 text-sm text-foreground shadow-sm transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
            Reset view
          </button>
        </div>
      </div>

      {widgetsOpen ? (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-foreground">
                Dashboard widgets
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Add, remove and reorder widgets for your own view.
              </div>
            </div>

            {savingLayout ? (
              <div className="text-xs text-muted-foreground">Saving…</div>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {availableWidgets.map((widget) => {
              const enabled = enabledWidgetIds.includes(widget.id);
              return (
                <button
                  key={widget.id}
                  type="button"
                  onClick={() => toggleWidget(widget.id)}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                    enabled
                      ? "border-primary/30 bg-primary/5 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{widget.label}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-wide opacity-70">
                      {widget.kind}
                    </div>
                  </div>

                  <div
                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                      enabled
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {enabled ? "Enabled" : "Hidden"}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      {kpiWidgets.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {kpiWidgets.map(renderWrappedWidget)}
        </div>
      ) : null}

      {otherWidgets.length > 0 ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          {otherWidgets.map(renderWrappedWidget)}
        </div>
      ) : null}
    </div>
  );
}