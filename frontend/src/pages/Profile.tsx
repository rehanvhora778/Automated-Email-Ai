import { type ReactNode } from "react";
import {
  CalendarDays, Check, Clock, Layers, Link2, Mail, MailOpen, MailWarning,
  PieChart as PieIcon, RefreshCw, Send, TrendingUp, User, Zap,
} from "lucide-react";
import { useAccountProfile, useEmailAnalytics } from "../lib/hooks";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatsCard } from "../components/dashboard/StatsCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { AreaTrend } from "../components/charts/AreaTrend";
import { DonutChart } from "../components/charts/DonutChart";

function formatDate(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatMonth(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** One fact row: icon square, bold label, real value (or —) underneath. */
function InfoRow({
  icon,
  label,
  value,
  right,
  loading = false,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
  right?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-brand-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-3.5 w-32" />
        ) : (
          <p className="truncate text-xs text-neutral-500">{value || "—"}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Profile({
  userEmail,
  userId,
  onLinkGmail,
}: {
  userEmail?: string;
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const { data: account, isLoading: accountLoading } = useAccountProfile(userId);
  const {
    data: analytics,
    isError: analyticsIsError,
    isPaused: analyticsPaused,
    refetch: refetchAnalytics,
  } = useEmailAnalytics(userId);

  const name = account?.fullName || userEmail?.split("@")[0] || "there";
  // Only claim anything about Gmail once the backend actually answered —
  // a failed or offline-paused query must not read as "not linked".
  const statusKnown = analytics !== undefined;
  const analyticsError = (analyticsIsError || analyticsPaused) && !statusKnown;
  const analyticsLoading = !statusKnown && !analyticsError;
  const needsReauth = !!analytics?.needs_reauth;
  const gmailLive = !!analytics?.gmail_linked && !needsReauth;
  const totals = analytics?.totals;

  const trend = (analytics?.daily ?? []).map((d) => ({ label: d.label, a: d.sent, b: d.received }));
  const segments = (analytics?.categories ?? []).map((c) => ({ name: c.name, value: c.count, color: c.color }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Hero — identity + at-a-glance status, all real */}
      <GlassCard glow className="overflow-hidden">
        <div className="relative h-28 bg-brand-gradient">
          <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        </div>
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end">
          <div className="-mt-20 shrink-0">
            <div className="rounded-[1.75rem] ring-4 ring-ink-900">
              <Avatar name={name} size={96} className="rounded-[1.5rem]" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight text-white">{name}</h1>
            <p className="truncate text-sm text-neutral-500">{userEmail}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {statusKnown &&
                (gmailLive ? (
                  <Badge tone="success" className="px-2.5 py-1">
                    <Check size={12} /> Gmail connected
                  </Badge>
                ) : needsReauth ? (
                  <Badge tone="warning" className="px-2.5 py-1">
                    <MailWarning size={12} /> Gmail needs re-link
                  </Badge>
                ) : (
                  <Badge tone="neutral" className="px-2.5 py-1">
                    <Mail size={12} /> Gmail not linked
                  </Badge>
                ))}
              {account?.memberSince && (
                <Badge tone="neutral" className="px-2.5 py-1">
                  <CalendarDays size={12} /> Joined {formatMonth(account.memberSince)}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Mailbox stats + activity — live Gmail data, never placeholders */}
      <div>
        <SectionHeader
          title="Mailbox at a Glance"
          icon={<Zap size={16} />}
          subtitle="Live numbers from your Gmail account"
        />
        {analyticsError ? (
          <GlassCard className="p-4">
            <ErrorState title="Couldn't load your mailbox stats" onRetry={() => refetchAnalytics()} />
          </GlassCard>
        ) : analyticsLoading || gmailLive ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatsCard
                icon={<Send size={20} />}
                label="Emails Sent"
                value={analytics?.sent_30d ?? 0}
                description={analytics?.sent_30d_capped ? "last 30 days (1,000+)" : "last 30 days"}
                accent="from-indigo-500/40 to-blue-500/30"
                loading={analyticsLoading}
              />
              <StatsCard
                icon={<MailOpen size={20} />}
                label="Emails Received"
                value={analytics?.received_30d ?? 0}
                description={analytics?.received_30d_capped ? "last 30 days (1,000+)" : "last 30 days"}
                accent="from-sky-500/40 to-cyan-500/30"
                loading={analyticsLoading}
                delay={0.05}
              />
              <StatsCard
                icon={<Mail size={20} />}
                label="Unread"
                value={totals?.unread ?? 0}
                description="right now"
                accent="from-amber-500/40 to-orange-500/30"
                loading={analyticsLoading}
                delay={0.1}
              />
              <StatsCard
                icon={<Layers size={20} />}
                label="All-Time Emails"
                value={totals?.messages ?? 0}
                description="entire mailbox"
                accent="from-violet-500/40 to-purple-500/30"
                loading={analyticsLoading}
                delay={0.15}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <SectionHeader
                  title="7-Day Activity"
                  icon={<TrendingUp size={16} />}
                  subtitle="Sent vs received this week"
                />
                <GlassCard className="p-6">
                  {analyticsLoading ? (
                    <Skeleton className="h-60 w-full rounded-2xl" />
                  ) : (
                    <>
                      <div className="mb-4 flex items-center gap-5 text-xs">
                        <span className="flex items-center gap-1.5 text-neutral-300">
                          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> Sent
                        </span>
                        <span className="flex items-center gap-1.5 text-neutral-300">
                          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Received
                        </span>
                      </div>
                      <AreaTrend data={trend} aName="Sent" bName="Received" height={220} />
                    </>
                  )}
                </GlassCard>
              </div>

              <div>
                <SectionHeader title="Inbox Mix" icon={<PieIcon size={16} />} subtitle="By Gmail category" />
                <GlassCard className="p-6">
                  {analyticsLoading ? (
                    <Skeleton className="h-60 w-full rounded-2xl" />
                  ) : (
                    <DonutChart data={segments} centerLabel="emails" />
                  )}
                </GlassCard>
              </div>
            </div>
          </div>
        ) : (
          <GlassCard className="p-2">
            <EmptyState
              icon={needsReauth ? <MailWarning size={26} /> : <Mail size={26} />}
              title={needsReauth ? "Re-link Gmail to restore your stats" : "Connect Gmail to see your real stats"}
              description={
                needsReauth
                  ? "Your Gmail was linked with send-only permission. Re-link once to grant read access."
                  : "No placeholder numbers here — link your Gmail to see your live sent, received and unread counts."
              }
              action={
                onLinkGmail ? (
                  <Button onClick={onLinkGmail}>
                    {needsReauth ? <RefreshCw size={16} /> : <Mail size={16} />}
                    {needsReauth ? "Re-link Gmail" : "Connect Gmail"}
                  </Button>
                ) : undefined
              }
            />
          </GlassCard>
        )}
      </div>

      {/* Account facts — straight from Supabase, balanced 2-column grid */}
      <div>
        <SectionHeader title="Account" icon={<User size={16} />} subtitle="Your Smart Email Agent account" />
        <GlassCard className="p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoRow icon={<User size={16} />} label="Full name" value={account?.fullName} loading={accountLoading} />
            <InfoRow icon={<Mail size={16} />} label="Email" value={userEmail} />
            <InfoRow
              icon={<CalendarDays size={16} />}
              label="Member since"
              value={formatDate(account?.memberSince)}
              loading={accountLoading}
            />
            <InfoRow
              icon={<Clock size={16} />}
              label="Last sign-in"
              value={formatDate(account?.lastSignInAt)}
              loading={accountLoading}
            />
            <div className="sm:col-span-2">
              <InfoRow
                icon={<Link2 size={16} className="text-rose-400" />}
                label="Gmail connection"
                value={
                  !statusKnown
                    ? null
                    : gmailLive
                      ? analytics?.email_address || "Connected"
                      : needsReauth
                        ? "Linked, but read access is missing"
                        : "Not linked"
                }
                loading={analyticsLoading}
                right={
                  !statusKnown ? undefined : gmailLive ? (
                    <Badge tone="success"><Check size={11} /> Live</Badge>
                  ) : (
                    <Button variant="glass" onClick={onLinkGmail} className="px-3 py-1.5 text-xs">
                      {needsReauth ? "Re-link" : "Link"}
                    </Button>
                  )
                }
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
