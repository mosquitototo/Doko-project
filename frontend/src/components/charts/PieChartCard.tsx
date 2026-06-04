import { ResponsiveContainer, PieChart, Pie, Tooltip } from "recharts";
import Card from "../ui/Card";
import type { DashboardRow } from "../../types/dashboard.types";

function truncate(s: string, n = 28) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function PieChartCard(props: {
  title: string;
  rows: DashboardRow[];
  height?: number;
}) {
  const { title, rows, height = 220 } = props;

  const data = (rows ?? []).filter((r) => r.value > 0);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{data.reduce((a, b) => a + b.value, 0)}</div>
      </div>

      {data.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No data.</div>
      ) : (
        <div className="w-full" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                outerRadius="80%"
                innerRadius="52%"
                isAnimationActive={false}
              />
              <Tooltip
                formatter={(value: any, name: any) => [value, truncate(String(name))]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.length > 0 ? (
        <div className="mt-3 space-y-1">
          {data.slice(0, 6).map((r) => (
            <div key={r.key ?? r.label} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 font-semibold text-foreground">{r.value}</span>
            </div>
          ))}
          {data.length > 6 ? (
            <div className="pt-1 text-[11px] text-muted-foreground">+ {data.length - 6} more…</div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
