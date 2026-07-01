import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, TrendingUp, TrendingDown, Send, Inbox, MailOpen, Timer,
  Zap, Gauge, Flame, User, Building2, PieChart as PieIcon, CalendarRange,
} from "lucide-react";
import { useInboxSummary } from "../lib/hooks";
import {
  weeklyTrend, monthlyTrend, categorySegments, activityWeeks, replySpeed, contacts,
} from "../lib/demo";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatsCard } from "../components/dashboard/StatsCard";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Badge } from "../components/ui/Badge";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";
import { AreaTrend } from "../components/charts/AreaTrend";
import { MiniBars } from "../components/charts/MiniBars";
import { DonutChart } from "../components/charts/DonutChart";
import { ActivityHeatmap, HeatmapLegend } from "../components/charts/ActivityHeatmap";

function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 text-xs font-semibold " +
        (up ? "text-emerald-400" : "text-rose-400")
      }
    >
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {Math.abs(value)}%
    </span>
  );
}

function MetricTile({
  icon, label, value, delta, hint, accent, delay = 0,
}: {
  icon: ReactNode; label: string; value: string; delta?: number; hint?: string; accent: string; delay?: number;
}) {
  return (
    <GlassCard delay={delay} className="p-5">
      <div className="flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${accent}`}>
          {icon}
        </div>
        {typeof delta === "number" && <Delta value={delta} />}
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-200">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </GlassCard>
  );
}

export function Analytics({ userId }: { userId?: string }) {
  const { data } = useInboxSummary(userId);
  const unread = data?.stats?.unread; // real when Gmail is linked
  const topContact = contacts[0];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <BarChart3 size={24} className="text-brand-400" /> Email Analytics
          </h1>
          <Badge tone="info">Preview data</Badge>
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          Your communication patterns at a glance — volume, speed, reach and reach-back rates.
        </p>
      </motion.div>

      {/* Top metric row */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatsCard icon={<Send size={20} />} label="Emails Sent" value={182} description="this month" accent="from-indigo-500/40 to-blue-500/30" delay={0} />
        <StatsCard icon={<Inbox size={20} />} label="Emails Received" value={438} description="this month" accent="from-sky-500/40 to-cyan-500/30" delay={0.05} />
        <StatsCard icon={<MailOpen size={20} />} label="Unread" value={unread ?? 23} description={unread != null ? "live from Gmail" : "in your inbox"} accent="from-amber-500/40 to-orange-500/30" delay={0.1} />
        <MetricTile icon={<Timer size={20} />} label="Avg Reply Time" value={replySpeed.average} delta={-12} hint="faster than last week" accent="from-emerald-500/40 to-teal-500/30" delay={0.15} />
      </div>

      {/* Trends */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionHeader title="Weekly Email Trend" icon={<TrendingUp size={16} />} subtitle="Sent vs received over the last 7 days" />
          <GlassCard className="p-6">
            <div className="mb-4 flex items-center gap-5 text-xs">
              <span className="flex items-center gap-1.5 text-neutral-300"><span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> Sent</span>
              <span className="flex items-center gap-1.5 text-neutral-300"><span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Received</span>
            </div>
            <AreaTrend data={weeklyTrend} aName="Sent" bName="Received" />
          </GlassCard>
        </div>

        <div>
          <SectionHeader title="Email Categories" icon={<PieIcon size={16} />} subtitle="How your inbox breaks down" />
          <GlassCard className="p-6">
            <DonutChart data={categorySegments} centerLabel="share" />
          </GlassCard>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div>
          <SectionHeader title="Monthly Volume" icon={<CalendarRange size={16} />} subtitle="Emails per week" />
          <GlassCard className="p-6">
            <MiniBars data={monthlyTrend} />
          </GlassCard>
        </div>

        {/* Reply speed analytics */}
        <div className="xl:col-span-2">
          <SectionHeader title="Reply Speed Analytics" icon={<Gauge size={16} />} subtitle="How quickly you respond" />
          <GlassCard className="p-6">
            <div className="grid gap-5 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                <Zap size={16} className="text-emerald-400" />
                <p className="mt-2 text-xl font-bold text-white">{replySpeed.fastest}</p>
                <p className="text-xs text-neutral-500">Fastest reply</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                <Timer size={16} className="text-brand-400" />
                <p className="mt-2 text-xl font-bold text-white">{replySpeed.average}</p>
                <p className="text-xs text-neutral-500">Average reply</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                <Flame size={16} className="text-rose-400" />
                <p className="mt-2 text-xl font-bold text-white">{replySpeed.slowest}</p>
                <p className="text-xs text-neutral-500">Slowest reply</p>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <ProgressBar label="Response rate" hint={`${replySpeed.responseRate}%`} value={replySpeed.responseRate} accent="from-emerald-500 to-teal-500" />
              <ProgressBar label="Open rate" hint={`${replySpeed.openRate}%`} value={replySpeed.openRate} accent="from-brand-500 to-fuchsia-500" delay={0.1} />
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Reach + heatmap */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4">
          <SectionHeader title="Top Contacts" icon={<User size={16} />} />
          <GlassCard className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-lg">
              <User size={22} />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{topContact.name}</p>
              <p className="text-xs text-neutral-500">Most contacted person</p>
            </div>
            <span className="ml-auto text-lg font-bold text-white tabular-nums">
              <AnimatedCounter value={topContact.conversations} />
            </span>
          </GlassCard>
          <GlassCard className="flex items-center gap-4 p-5" delay={0.05}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-lg">
              <Building2 size={22} />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{topContact.company}</p>
              <p className="text-xs text-neutral-500">Most contacted company</p>
            </div>
            <span className="ml-auto text-lg font-bold text-white tabular-nums">
              <AnimatedCounter value={64} />
            </span>
          </GlassCard>
        </div>

        <div className="xl:col-span-2">
          <SectionHeader title="Activity Heatmap" icon={<Flame size={16} />} subtitle="Emails handled per day" action={<HeatmapLegend />} />
          <GlassCard className="p-6">
            <ActivityHeatmap weeks={activityWeeks} />
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
