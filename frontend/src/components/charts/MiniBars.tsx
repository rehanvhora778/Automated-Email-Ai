import { useId } from "react";
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface BarPoint {
  label: string;
  value: number;
}

/** Rounded gradient bar chart; the tallest bar is highlighted. */
export function MiniBars({
  data,
  height = 220,
  color = "#8b5cf6",
}: {
  data: BarPoint[];
  height?: number;
  color?: string;
}) {
  const id = useId().replace(/:/g, "");
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={`bar-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.95} />
            <stop offset="100%" stopColor={color} stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fill: "#737373", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#737373", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{
            background: "rgba(10,10,10,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            fontSize: 12,
            color: "#fff",
          }}
        />
        <Bar dataKey="value" radius={[8, 8, 4, 4]} maxBarSize={44}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value === max ? "#d946ef" : `url(#bar-${id})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
