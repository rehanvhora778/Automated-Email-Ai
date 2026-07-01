import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DonutSegment {
  name: string;
  value: number;
  color: string;
}

/** Reusable donut with a centred total and a legend column. */
export function DonutChart({
  data,
  centerLabel = "total",
  size = 168,
}: {
  data: DonutSegment[];
  centerLabel?: string;
  size?: number;
}) {
  const segments = data.filter((d) => d.value > 0);
  const total = segments.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-[168px] items-center justify-center text-xs text-neutral-600">
        No data yet
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              innerRadius={size * 0.32}
              outerRadius={size * 0.46}
              paddingAngle={3}
              stroke="none"
            >
              {segments.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "rgba(10,10,10,0.92)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                fontSize: 12,
                color: "#fff",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-white">{total}</span>
          <span className="text-[10px] uppercase tracking-widest text-neutral-500">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {segments.map((d) => (
          <div key={d.name} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="flex-1 text-neutral-300">{d.name}</span>
            <span className="font-semibold tabular-nums text-white">
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
