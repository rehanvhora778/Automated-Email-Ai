import { motion } from "framer-motion";
import {
  BarChart3, Send, Inbox as InboxIcon, MailOpen, Layers, TrendingUp,
  PieChart as PieIcon, Users, Mail, MailWarning, RefreshCw, MessagesSquare,
} from "lucide-react";
import { useEmailAnalytics } from "../lib/hooks";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatsCard } from "../components/dashboard/StatsCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { Avatar } from "../components/ui/Avatar";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";
import { AreaTrend } from "../components/charts/AreaTrend";
import { DonutChart } from "../components/charts/DonutChart";

function LoadingGrid() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-3xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-72 w-full rounded-3xl xl:col-span-2" />
        <Skeleton className="h-72 w-full rounded-3xl" />
      </div>
    </div>
  );
}

export function Analytics({
  userId,
  onLinkGmail,
}: {
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useEmailAnalytics(userId);

  const totals = data?.totals;
  const trend = (data?.daily ?? []).map((d) => ({ label: d.label, a: d.sent, b: d.received }));
  const segments = (data?.categories ?? []).map((c) => ({ name: c.name, value: c.count, color: c.color }));
  const senders = data?.top_senders ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <BarChart3 size={24} className="text-brand-400" /> Email Analytics
          </h1>
          {data?.gmail_linked && !data?.needs_reauth && (
            <button
              onClick={() => refetch()}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              title="Refresh"
            >
              <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          Live from your Gmail{data?.email_address ? ` — ${data.email_address}` : ""}.
        </p>
      </motion.div>

      {isLoading ? (
        <LoadingGrid />
      ) : isError ? (
        <GlassCard className="p-4">
          <ErrorState
            title="Couldn't load analytics"
            message={(error as Error)?.message}
            onRetry={() => refetch()}
          />
        </GlassCard>
      ) : !data?.gmail_linked ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<Mail size={26} />}
            title="Connect Gmail to see your analytics"
            description="Link your Gmail account to see real sending volume, daily trends, category breakdowns and your top senders."
            action={
              onLinkGmail ? (
                <Button onClick={onLinkGmail}>
                  <Mail size={16} /> Connect Gmail
                </Button>
              ) : undefined
            }
          />
        </GlassCard>
      ) : data?.needs_reauth ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<MailWarning size={26} />}
            title="Re-link Gmail for read access"
            description="Your Gmail was linked with send-only permission. Re-link once to grant read access so analytics can be computed."
            action={
              onLinkGmail ? (
                <Button onClick={onLinkGmail}>
                  <RefreshCw size={16} /> Re-link Gmail
                </Button>
              ) : undefined
            }
          />
        </GlassCard>
      ) : (
        <>
          {/* Top metric row — all live Gmail counts */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatsCard
              icon={<Send size={20} />}
              label="Emails Sent"
              value={data.sent_30d ?? 0}
              description={data.sent_30d_capped ? "last 30 days (1,000+)" : "last 30 days"}
              accent="from-indigo-500/40 to-blue-500/30"
              delay={0}
            />
            <StatsCard
              icon={<InboxIcon size={20} />}
              label="Emails Received"
              value={data.received_30d ?? 0}
              description={data.received_30d_capped ? "last 30 days (1,000+)" : "last 30 days"}
              accent="from-sky-500/40 to-cyan-500/30"
              delay={0.05}
            />
            <StatsCard
              icon={<MailOpen size={20} />}
              label="Unread"
              value={totals?.unread ?? 0}
              description="right now"
              accent="from-amber-500/40 to-orange-500/30"
              delay={0.1}
            />
            <StatsCard
              icon={<Layers size={20} />}
              label="In Inbox"
              value={totals?.inbox ?? 0}
              description="total messages"
              accent="from-emerald-500/40 to-teal-500/30"
              delay={0.15}
            />
          </div>

          {/* Trend + categories */}
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <SectionHeader
                title="Daily Email Trend"
                icon={<TrendingUp size={16} />}
                subtitle="Sent vs received over the last 7 days"
              />
              <GlassCard className="p-6">
                <div className="mb-4 flex items-center gap-5 text-xs">
                  <span className="flex items-center gap-1.5 text-neutral-300">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> Sent
                  </span>
                  <span className="flex items-center gap-1.5 text-neutral-300">
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Received
                  </span>
                </div>
                <AreaTrend data={trend} aName="Sent" bName="Received" />
              </GlassCard>
            </div>

            <div>
              <SectionHeader
                title="Email Categories"
                icon={<PieIcon size={16} />}
                subtitle="Gmail's category breakdown"
              />
              <GlassCard className="p-6">
                <DonutChart data={segments} centerLabel="emails" />
              </GlassCard>
            </div>
          </div>

          {/* Mailbox totals + top senders */}
          <div className="grid gap-6 xl:grid-cols-3">
            <div>
              <SectionHeader title="Mailbox Totals" icon={<MessagesSquare size={16} />} subtitle="All time" />
              <GlassCard className="space-y-3 p-6">
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Emails</p>
                    <p className="text-xs text-neutral-500">every message in this account</p>
                  </div>
                  <span className="text-xl font-bold text-white tabular-nums">
                    <AnimatedCounter value={totals?.messages ?? 0} />
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Conversations</p>
                    <p className="text-xs text-neutral-500">total threads</p>
                  </div>
                  <span className="text-xl font-bold text-white tabular-nums">
                    <AnimatedCounter value={totals?.threads ?? 0} />
                  </span>
                </div>
              </GlassCard>
            </div>

            <div className="xl:col-span-2">
              <SectionHeader
                title="Top Senders"
                icon={<Users size={16} />}
                subtitle="Who fills your inbox — from your latest 50 emails"
              />
              <GlassCard className="p-6">
                {senders.length ? (
                  <div className="space-y-3">
                    {senders.map((s) => (
                      <div key={s.email} className="flex items-center gap-3">
                        <Avatar name={s.name} size={36} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{s.name}</p>
                          <p className="truncate text-xs text-neutral-500">{s.email}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold tabular-nums text-neutral-200">
                          {s.count} email{s.count === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Users size={24} />}
                    title="No senders yet"
                    description="Your recent inbox is empty."
                  />
                )}
              </GlassCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
