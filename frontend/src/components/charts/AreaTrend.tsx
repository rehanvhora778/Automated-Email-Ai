import { useId } from "react";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

export interface TrendPoint {
  label: string;
  a: number;
  b?: number;
}

const tooltipStyle = {
  background: "rgba(10,10,10,0.92)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  fontSize: 12,
  color: "#fff",
} as const;

/** Smooth gradient area chart (one or two series) used across analytics. */
export function AreaTrend({
  data,
  height = 240,
  aName = "Series A",
  bName = "Series B",
  aColor = "#6366f1",
  bColor = "#22d3ee",
}: {
  data: TrendPoint[];
  height?: number;
  aName?: string;
  bName?: string;
  aColor?: string;
  bColor?: string;
}) {
  const id = useId().replace(/:/g, "");
  const hasB = data.some((d) => typeof d.b === "number");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={`a-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={aColor} stopOpacity={0.5} />
            <stop offset="100%" stopColor={aColor} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`b-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={bColor} stopOpacity={0.4} />
            <stop offset="100%" stopColor={bColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#737373", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#737373", fontSize: 11 }} axisLine={false} tickLine={false} width={38} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
        <Area type="monotone" dataKey="a" name={aName} stroke={aColor} strokeWidth={2.5} fill={`url(#a-${id})`} />
        {hasB && (
          <Area type="monotone" dataKey="b" name={bName} stroke={bColor} strokeWidth={2.5} fill={`url(#b-${id})`} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
