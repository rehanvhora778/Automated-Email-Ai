import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Mail, Star, CalendarClock, ListChecks, Sparkles, Zap, PieChart as PieIcon,
  Gauge, TrendingUp, Activity, Lightbulb, Clock, Video, ArrowUpRight,
  Reply, Inbox, PenLine, Languages,
} from "lucide-react";
import { useInboxSummary } from "../lib/hooks";
import type { ToolAction } from "../lib/types";
import { cn } from "../lib/cn";
import { StatsCard } from "../components/dashboard/StatsCard";
import { AISuggestionCard } from "../components/dashboard/AISuggestionCard";
import { QuickActionGrid, type QuickActionKey } from "../components/dashboard/QuickActionGrid";
import { InboxSummary } from "../components/dashboard/InboxSummary";
import { InboxBreakdownChart } from "../components/dashboard/InboxBreakdownChart";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { RadialScore } from "../components/ui/RadialScore";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { AreaTrend } from "../components/charts/AreaTrend";
import { weeklyTrend, recentAiActions, smartRecommendations, meetings } from "../lib/demo";

const aiActionMeta: Record<string, { icon: ReactNode; color: string }> = {
  reply: { icon: <Reply size={15} />, color: "text-blue-400 bg-blue-500/10" },
  summarize: { icon: <Inbox size={15} />, color: "text-sky-400 bg-sky-500/10" },
  compose: { icon: <PenLine size={15} />, color: "text-violet-400 bg-violet-500/10" },
  translate: { icon: <Languages size={15} />, color: "text-amber-400 bg-amber-500/10" },
  schedule: { icon: <CalendarClock size={15} />, color: "text-emerald-400 bg-emerald-500/10" },
};

function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

export function Dashboard({
  userId,
  fallbackName,
  onNavigate,
  onCompose,
  onOpenTool,
  onLinkGmail,
}: {
  userId?: string;
  fallbackName: string;
  onNavigate: (view: string) => void;
  onCompose: () => void;
  onOpenTool: (action: ToolAction) => void;
  onLinkGmail: () => void;
}) {
  const { data, isLoading } = useInboxSummary(userId);

  const name = data?.user_name || fallbackName;
  const stats = data?.stats;
  const suggestions = data?.suggestions ?? [];
  const upcomingMeetings = meetings.filter((m) => m.day !== "week").slice(0, 4);

  const statCards = [
    { label: "Unread Emails", value: stats?.unread ?? 0, icon: <Mail size={20} />, desc: "in your inbox", accent: "from-indigo-500/40 to-blue-500/30" },
    { label: "High Priority", value: stats?.high_priority ?? 0, icon: <Star size={20} />, desc: "need attention", accent: "from-rose-500/40 to-pink-500/30" },
    { label: "Meetings Today", value: stats?.meetings_today ?? 0, icon: <CalendarClock size={20} />, desc: "detected in mail", accent: "from-amber-500/40 to-orange-500/30" },
    { label: "Pending Follow-ups", value: stats?.pending_followups ?? 0, icon: <ListChecks size={20} />, desc: "awaiting a reply", accent: "from-emerald-500/40 to-teal-500/30" },
  ];

  const handleQuickAction = (key: QuickActionKey) => {
    if (key === "compose") return onCompose();
    if (key === "summarize_inbox") return onNavigate("inbox");
    if (key === "generate_reply") return onNavigate("smartReply");
    onOpenTool(key as ToolAction);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* Greeting */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {greetingFor()}, <span className="gradient-text">{name}</span> 👋
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Here's your workspace overview. Let AI handle the busywork.
        </p>
      </motion.div>

      {/* Stats */}
      <div>
        <SectionHeader title="Today's Overview" icon={<Zap size={16} />} />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {statCards.map((c, i) => (
            <StatsCard
              key={c.label}
              icon={c.icon}
              label={c.label}
              value={c.value}
              description={c.desc}
              accent={c.accent}
              loading={isLoading}
              delay={i * 0.06}
              onClick={() => onNavigate("inbox")}
            />
          ))}
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Left: suggestions + quick actions + chart */}
        <div className="space-y-8 xl:col-span-2">
          {/* AI suggestions */}
          <div>
            <SectionHeader title="Today's AI Suggestions" icon={<Sparkles size={16} />} />
            {suggestions.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {suggestions.map((s, i) => (
                  <AISuggestionCard
                    key={i}
                    title={s.title}
                    type={s.type}
                    delay={i * 0.05}
                    onClick={() => onNavigate("smartReply")}
                  />
                ))}
              </div>
            ) : (
              <GlassCard className="p-2">
                <EmptyState
                  icon={<Sparkles size={24} />}
                  title="No suggestions yet"
                  description={
                    data?.gmail_linked
                      ? "You're all caught up — nothing needs action right now."
                      : "Connect Gmail and AI will suggest replies and follow-ups here."
                  }
                />
              </GlassCard>
            )}
          </div>

          {/* Quick actions */}
          <div>
            <SectionHeader title="Quick Actions" icon={<Zap size={16} />} />
            <QuickActionGrid onAction={handleQuickAction} />
          </div>

          {/* Inbox composition chart (real data) */}
          {data?.gmail_linked && !data?.needs_reauth && (
            <div>
              <SectionHeader title="Inbox Composition" icon={<PieIcon size={16} />} />
              <GlassCard className="p-6">
                <InboxBreakdownChart
                  important={data?.important?.length ?? 0}
                  newsletters={data?.newsletters?.count ?? 0}
                  promotions={data?.spam?.count ?? 0}
                />
              </GlassCard>
            </div>
          )}
        </div>

        {/* Right: inbox summary widget */}
        <div className="xl:col-span-1">
          <div className="xl:sticky xl:top-6">
            <InboxSummary userId={userId} onLinkGmail={onLinkGmail} />
          </div>
        </div>
      </div>

      {/* ===== AI Command Center (additive insight widgets) ===== */}
      <div>
        <SectionHeader
          title="AI Command Center"
          icon={<Gauge size={16} />}
          subtitle="Your productivity, trends and next best actions"
          action={<Badge tone="info">Preview</Badge>}
        />
        <div className="grid gap-6 xl:grid-cols-3">
          {/* Productivity score */}
          <GlassCard className="flex flex-col items-center p-6">
            <div className="mb-4 flex items-center gap-2 self-start text-xs font-bold uppercase tracking-widest text-neutral-400">
              <Gauge size={14} className="text-brand-400" /> Productivity Score
            </div>
            <RadialScore value={82} label="this week" />
            <div className="mt-6 w-full space-y-3">
              <ProgressBar label="Response rate" hint="87%" value={87} accent="from-emerald-500 to-teal-500" />
              <ProgressBar label="Reply speed" hint="2h 14m" value={72} accent="from-brand-500 to-fuchsia-500" delay={0.1} />
              <ProgressBar label="Inbox-zero streak" hint="6 days" value={60} accent="from-amber-500 to-orange-500" delay={0.2} />
            </div>
          </GlassCard>

          {/* Weekly email trend */}
          <GlassCard className="p-6 xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
                <TrendingUp size={14} className="text-brand-400" /> Weekly Email Trend
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-neutral-300"><span className="h-2 w-2 rounded-full bg-brand-500" /> Sent</span>
                <span className="flex items-center gap-1.5 text-neutral-300"><span className="h-2 w-2 rounded-full bg-cyan-400" /> Received</span>
              </div>
            </div>
            <AreaTrend data={weeklyTrend} aName="Sent" bName="Received" height={210} />
          </GlassCard>
        </div>
      </div>

      {/* Insight trio */}
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Recent AI actions */}
        <GlassCard className="p-6">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
            <Activity size={14} className="text-brand-400" /> Recent AI Actions
          </div>
          <div className="space-y-3.5">
            {recentAiActions.map((a, i) => {
              const meta = aiActionMeta[a.kind] ?? aiActionMeta.summarize;
              return (
                <div key={i} className="flex items-start gap-3">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", meta.color)}>{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{a.action}</p>
                    <p className="truncate text-xs text-neutral-500">{a.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-neutral-600">{a.time}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Smart recommendations */}
        <GlassCard className="p-6">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
            <Lightbulb size={14} className="text-brand-400" /> Smart Recommendations
          </div>
          <div className="space-y-2.5">
            {smartRecommendations.map((r, i) => (
              <button
                key={i}
                onClick={() => onNavigate("inbox")}
                className="group flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-left transition-all hover:border-white/15 hover:bg-white/[0.06]"
              >
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg", r.accent)}>
                  <Lightbulb size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{r.title}</p>
                  <p className="truncate text-xs text-neutral-500">{r.detail}</p>
                </div>
                <ArrowUpRight size={16} className="shrink-0 text-neutral-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white" />
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Upcoming meetings */}
        <GlassCard className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
              <CalendarClock size={14} className="text-brand-400" /> Upcoming Meetings
            </div>
            <button onClick={() => onNavigate("calendar")} className="text-xs font-semibold text-brand-300 hover:text-brand-200">
              View all
            </button>
          </div>
          <div className="space-y-3.5">
            {upcomingMeetings.map((m, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg", m.accent)}>
                  <Video size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{m.title}</p>
                  <p className="flex items-center gap-1 text-xs text-neutral-500"><Clock size={11} /> {m.time}</p>
                </div>
                <div className="flex -space-x-2">
                  {m.attendees.map((a) => (
                    <Avatar key={a} name={a} size={24} className="rounded-lg ring-2 ring-ink-900" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
