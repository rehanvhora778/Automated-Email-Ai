import { motion } from "framer-motion";
import {
  RefreshCw, Mail, MailWarning, Sparkles, Star, Newspaper, ListChecks, ShieldAlert,
} from "lucide-react";
import { useInboxSummary } from "../../lib/hooks";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { SectionHeader } from "../ui/SectionHeader";

function LoadingRows() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-5/6" />
    </div>
  );
}

export function InboxSummary({
  userId,
  onLinkGmail,
}: {
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useInboxSummary(userId);

  return (
    <GlassCard className="p-6">
      <SectionHeader
        title="AI Inbox Summary"
        subtitle={data?.gmail_linked && data?.stats ? `${data.stats.total} recent · ${data.stats.unread} unread` : "Your inbox, briefed"}
        icon={<Sparkles size={16} />}
        action={
          data?.gmail_linked ? (
            <button
              onClick={() => refetch()}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              title="Refresh"
            >
              <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
            </button>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState
          title="Couldn't load your inbox"
          message={(error as Error)?.message}
          onRetry={() => refetch()}
        />
      ) : !data?.gmail_linked ? (
        <EmptyState
          icon={<Mail size={26} />}
          title="Connect Gmail to see your summary"
          description="Link your Gmail account and AI will brief you on what's important, what needs a reply, and what's just noise."
          action={
            onLinkGmail ? (
              <Button onClick={onLinkGmail}>
                <Mail size={16} /> Connect Gmail
              </Button>
            ) : undefined
          }
        />
      ) : data?.needs_reauth ? (
        <EmptyState
          icon={<MailWarning size={26} />}
          title="Re-link Gmail for read access"
          description="Your Gmail was linked with send-only permission. Re-link once to grant read access so AI can summarize your inbox."
          action={
            onLinkGmail ? (
              <Button onClick={onLinkGmail}>
                <RefreshCw size={16} /> Re-link Gmail
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Summary blurb */}
          {data.summary && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-brand-500/20 bg-brand-500/[0.07] p-4"
            >
              <p className="text-sm leading-relaxed text-neutral-200">{data.summary}</p>
            </motion.div>
          )}

          {/* Important */}
          {!!data.important?.length && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
                <Star size={13} className="text-amber-400" /> Important
              </div>
              <div className="space-y-2">
                {data.important.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-2xl border border-white/5 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-white">{m.subject}</span>
                      <span className="shrink-0 truncate text-xs text-neutral-500">{m.sender}</span>
                    </div>
                    {m.insight && <p className="mt-1 text-xs text-neutral-400">{m.insight}</p>}
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Spam + Newsletters row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
              <ShieldAlert size={16} className="text-orange-400" />
              <p className="mt-2 text-2xl font-bold text-white tabular-nums">{data.spam?.count ?? 0}</p>
              <p className="text-xs text-neutral-500">{data.spam?.note || "Promotional / spam"}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
              <Newspaper size={16} className="text-cyan-400" />
              <p className="mt-2 text-2xl font-bold text-white tabular-nums">{data.newsletters?.count ?? 0}</p>
              <p className="text-xs text-neutral-500">{data.newsletters?.note || "Newsletters"}</p>
            </div>
          </div>

          {/* Action needed */}
          {!!data.action_items?.length && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
                <ListChecks size={13} className="text-emerald-400" /> Action Needed
              </div>
              <div className="space-y-1.5">
                {data.action_items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-sm text-neutral-300"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
