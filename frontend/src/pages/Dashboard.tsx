import { motion } from "framer-motion";
import {
  Mail, Star, ListChecks, Sparkles, Zap, PieChart as PieIcon, Inbox,
} from "lucide-react";
import { useInboxSummary } from "../lib/hooks";
import type { ToolAction } from "../lib/types";
import { StatsCard } from "../components/dashboard/StatsCard";
import { AISuggestionCard } from "../components/dashboard/AISuggestionCard";
import { QuickActionGrid, type QuickActionKey } from "../components/dashboard/QuickActionGrid";
import { InboxSummary } from "../components/dashboard/InboxSummary";
import { InboxBreakdownChart } from "../components/dashboard/InboxBreakdownChart";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { EmptyState } from "../components/ui/EmptyState";

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

  const statCards = [
    { label: "Unread Emails", value: stats?.unread ?? 0, icon: <Mail size={20} />, desc: "in your inbox", accent: "from-indigo-500/40 to-blue-500/30" },
    { label: "High Priority", value: stats?.high_priority ?? 0, icon: <Star size={20} />, desc: "need attention", accent: "from-rose-500/40 to-pink-500/30" },
    { label: "Pending Follow-ups", value: stats?.pending_followups ?? 0, icon: <ListChecks size={20} />, desc: "awaiting a reply", accent: "from-emerald-500/40 to-teal-500/30" },
    { label: "Emails Analyzed", value: stats?.total ?? 0, icon: <Inbox size={20} />, desc: "in this briefing", accent: "from-amber-500/40 to-orange-500/30" },
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
    </div>
  );
}
