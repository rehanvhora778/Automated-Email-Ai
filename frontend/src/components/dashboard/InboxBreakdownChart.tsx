import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

/** Donut chart of the current inbox composition — driven by real summary counts. */
export function InboxBreakdownChart({
  important,
  newsletters,
  promotions,
}: {
  important: number;
  newsletters: number;
  promotions: number;
}) {
  const data = [
    { name: "Important", value: important, color: "#6366f1" },
    { name: "Newsletters", value: newsletters, color: "#22d3ee" },
    { name: "Promotions", value: promotions, color: "#f59e0b" },
  ].filter((d) => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-xs text-neutral-600">
        No categorized mail yet
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={48}
              outerRadius={68}
              paddingAngle={3}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "rgba(10,10,10,0.9)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                fontSize: 12,
                color: "#fff",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white tabular-nums">{total}</span>
          <span className="text-[10px] uppercase tracking-widest text-neutral-500">emails</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="flex-1 text-neutral-300">{d.name}</span>
            <span className="font-semibold text-white tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
