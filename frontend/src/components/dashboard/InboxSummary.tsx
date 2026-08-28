import { RefreshCw, Mail, MailWarning, Sparkles, Inbox } from "lucide-react";
import { useInboxSummary } from "../../lib/hooks";
import type { InboxBriefing, InboxSummaryResponse } from "../../lib/types";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { SectionHeader } from "../ui/SectionHeader";
import { InboxBriefingView } from "../inbox/InboxBriefing";

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

/** The response carries the briefing inline; fill in anything the API omitted. */
function toBriefing(data: InboxSummaryResponse): InboxBriefing {
  return {
    overview: data.overview ?? data.summary ?? "",
    emails: data.emails ?? [],
    groups: data.groups ?? [],
    delivery_failures: data.delivery_failures ?? [],
    recommended_actions: data.recommended_actions ?? [],
    counts: data.counts ?? {
      analyzed: 0, needs_reply: 0, action_required: 0, important: 0, needs_review: 0,
      high_priority: 0, promotional: 0, newsletters: 0, low_priority: 0,
      grouped: 0, delivery_failures: 0,
    },
    scope: data.scope ?? {
      analyzed: 0, unread_analyzed: 0, unread_total: 0, read_included: 0,
      capped: false, bodies_read: 0,
    },
    degraded: data.degraded ?? false,
  };
}

export function InboxSummary({
  userId,
  onLinkGmail,
}: {
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useInboxSummary(userId);
  const stats = data?.stats;
  const briefing = data ? toBriefing(data) : null;
  const isEmpty =
    !!briefing &&
    !briefing.emails.length &&
    !briefing.groups.length &&
    !briefing.delivery_failures.length;

  return (
    <GlassCard className="p-6">
      <SectionHeader
        title="AI Inbox Summary"
        subtitle={
          data?.gmail_linked && stats
            ? `${stats.unread} unread · ${stats.analyzed} analysed`
            : "Your inbox, briefed"
        }
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
          description="Link your Gmail account and AI will classify every unread email — what needs a reply, what needs an action, what failed to send, and what's just noise."
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
      ) : isEmpty ? (
        <EmptyState
          icon={<Inbox size={26} />}
          title="Nothing waiting on you"
          description={briefing?.overview || "No unread mail to report."}
        />
      ) : (
        briefing && <InboxBriefingView briefing={briefing} />
      )}
    </GlassCard>
  );
}
