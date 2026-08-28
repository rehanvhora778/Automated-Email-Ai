import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Reply, ListChecks, Star, HelpCircle, Layers, MailX, Clock,
  Sparkles, Eye, Trash2, BookOpen, Send, CircleAlert, ChevronDown, ChevronRight,
} from "lucide-react";
import type {
  BriefedEmail, BriefedGroup, DeliveryFailure, EmailCategory, InboxBriefing as Briefing,
  RecommendedAction, Urgency,
} from "../../lib/types";
import { timeAgo } from "../../lib/time";
import { Badge } from "../ui/Badge";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const CATEGORY_STYLE: Record<EmailCategory, { tone: Tone; icon: ReactNode; accent: string }> = {
  "Requires Action": { tone: "danger", icon: <ListChecks size={12} />, accent: "border-l-rose-500/70" },
  "Requires Reply": { tone: "brand", icon: <Reply size={12} />, accent: "border-l-brand-500/70" },
  Important: { tone: "warning", icon: <Star size={12} />, accent: "border-l-amber-500/70" },
  "Needs Review": { tone: "neutral", icon: <HelpCircle size={12} />, accent: "border-l-neutral-500/70" },
  Promotional: { tone: "info", icon: <Layers size={12} />, accent: "border-l-sky-500/70" },
  Newsletter: { tone: "info", icon: <BookOpen size={12} />, accent: "border-l-cyan-500/70" },
  "Low Priority": { tone: "neutral", icon: <Layers size={12} />, accent: "border-l-neutral-500/70" },
};

const URGENCY_TONE: Record<Urgency, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

const ACTION_ICON: Record<RecommendedAction["type"], ReactNode> = {
  reply: <Reply size={13} />,
  action: <ListChecks size={13} />,
  review: <Eye size={13} />,
  read: <BookOpen size={13} />,
  cleanup: <Trash2 size={13} />,
  fix_delivery: <Send size={13} />,
};

function Heading({ icon, children, count }: { icon: ReactNode; children: string; count?: number }) {
  return (
    <div className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
      {icon}
      {children}
      {count !== undefined && <span className="text-neutral-600 tabular-nums">({count})</span>}
    </div>
  );
}

/** One bounce, reported from the delivery notice's own headers. */
function FailureCard({ failure }: { failure: DeliveryFailure }) {
  const target = failure.failed_recipient || "an address the notice did not name";
  const permanence =
    failure.permanent === true ? "was permanently rejected"
    : failure.permanent === false ? "was temporarily deferred"
    : "was returned undelivered";

  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.07] p-4">
      <div className="flex items-start gap-3">
        <MailX size={17} className="mt-0.5 shrink-0 text-rose-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-neutral-100">
            {failure.original_subject ? (
              <>Your message <span className="font-semibold">“{failure.original_subject}”</span></>
            ) : (
              <>A message you sent</>
            )}{" "}
            to <span className="font-semibold break-all">{target}</span> {permanence}.
          </p>
          {failure.reason && <p className="mt-1.5 text-xs text-neutral-400">{failure.reason}</p>}
          {failure.what_to_do && (
            <p className="mt-2 text-xs text-rose-200/90">
              <span className="font-semibold">What to do:</span> {failure.what_to_do}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {failure.status && <Badge tone="danger">SMTP {failure.status}</Badge>}
            {failure.date_ms > 0 && <Badge tone="neutral">{timeAgo(failure.date_ms)}</Badge>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One analysed email, with the model's reasoning under the facts. */
function EmailCard({ email, index }: { email: BriefedEmail; index: number }) {
  const style = CATEGORY_STYLE[email.category] ?? CATEGORY_STYLE["Needs Review"];

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      className={cn("rounded-2xl border border-white/5 border-l-2 bg-white/[0.02] p-3.5", style.accent)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={style.tone}>{style.icon}{email.category}</Badge>
        <Badge tone={URGENCY_TONE[email.urgency]}>{email.urgency}</Badge>
        {email.needs_reply && <Badge tone="brand"><Reply size={11} /> Reply needed</Badge>}
        {email.deadline && <Badge tone="danger"><Clock size={11} /> {email.deadline}</Badge>}
      </div>

      <p className="mt-2 truncate text-sm font-semibold text-white">{email.subject}</p>
      <p className="mt-0.5 truncate text-xs text-neutral-500">
        {email.sender}
        {email.date_ms > 0 && <> · {timeAgo(email.date_ms)}</>}
      </p>

      {email.summary && <p className="mt-2 text-xs leading-relaxed text-neutral-300">{email.summary}</p>}

      {email.why_it_matters && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          <span className="font-semibold text-neutral-300">Why it matters: </span>
          {email.why_it_matters}
        </p>
      )}

      {email.required_action && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-2.5 py-1.5">
          <ListChecks size={13} className="mt-0.5 shrink-0 text-emerald-400" />
          <span className="text-xs text-emerald-100/90">{email.required_action}</span>
        </div>
      )}

      {email.category === "Needs Review" && email.review_reason && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-2.5 py-1.5">
          <CircleAlert size={13} className="mt-0.5 shrink-0 text-amber-400" />
          <span className="text-xs text-amber-100/80">{email.review_reason}</span>
        </div>
      )}
    </motion.div>
  );
}

/** Similar bulk mail, rolled up so it takes one line instead of ten. */
function GroupRow({ group }: { group: BriefedGroup }) {
  const [open, setOpen] = useState(false);
  const style = CATEGORY_STYLE[group.category] ?? CATEGORY_STYLE["Low Priority"];
  const canExpand = group.subjects.length > 0;

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2.5 text-left",
          canExpand && "transition-colors hover:bg-white/[0.03]"
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-neutral-400">
          {style.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-neutral-200">
            <span className="font-semibold tabular-nums">{group.count}</span> {group.label}
          </span>
          <span className="block truncate text-xs text-neutral-500">
            {group.senders.join(", ") || group.category}
          </span>
        </span>
        {canExpand &&
          (open ? <ChevronDown size={15} className="shrink-0 text-neutral-500" />
                : <ChevronRight size={15} className="shrink-0 text-neutral-500" />)}
      </button>
      {open && (
        <div className="border-t border-white/5 px-3 py-2.5">
          {group.note && <p className="mb-2 text-xs text-neutral-400">{group.note}</p>}
          <ul className="space-y-1">
            {group.subjects.map((subject, i) => (
              <li key={i} className="truncate text-xs text-neutral-500">· {subject}</li>
            ))}
            {group.count > group.subjects.length && (
              <li className="text-xs text-neutral-600">
                + {group.count - group.subjects.length} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: RecommendedAction }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-500/15 text-[11px] font-bold text-brand-200 tabular-nums">
        {action.priority}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-100">{action.action}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{action.reason}</p>
      </div>
      <span className="mt-0.5 shrink-0 text-neutral-600" title={action.type.replace("_", " ")}>
        {ACTION_ICON[action.type] ?? <ListChecks size={13} />}
      </span>
    </div>
  );
}

/**
 * The full inbox briefing: overview, delivery failures, the emails that need
 * attention, grouped bulk mail, then the ranked actions.
 */
export function InboxBriefingView({ briefing }: { briefing: Briefing }) {
  const { counts, scope } = briefing;
  const attention = briefing.emails;

  return (
    <div className="space-y-6">
      {briefing.degraded && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-100/90">
            AI analysis is unavailable, so nothing below has been classified by content.
            Delivery failures and the grouping still come straight from Gmail.
          </p>
        </div>
      )}

      {briefing.overview && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-brand-500/20 bg-brand-500/[0.07] p-4"
        >
          <p className="text-sm leading-relaxed text-neutral-200">{briefing.overview}</p>
          {scope && (
            <p className="mt-2.5 text-[11px] text-neutral-500">
              Analysed {scope.unread_analyzed} unread
              {scope.capped && ` of ${scope.unread_total}`}
              {scope.read_included > 0 && ` · ${scope.read_included} recent read for context`}
              {scope.bodies_read > 0 && ` · ${scope.bodies_read} opened in full`}
            </p>
          )}
        </motion.div>
      )}

      {!!briefing.delivery_failures?.length && (
        <div>
          <Heading icon={<MailX size={13} className="text-rose-400" />} count={counts?.delivery_failures}>
            Delivery Failures
          </Heading>
          <div className="space-y-2">
            {briefing.delivery_failures.map((f) => (
              <FailureCard key={f.message_id} failure={f} />
            ))}
          </div>
        </div>
      )}

      {!!attention?.length && (
        <div>
          <Heading icon={<Sparkles size={13} className="text-brand-400" />} count={attention.length}>
            Needs Your Attention
          </Heading>
          <div className="space-y-2">
            {attention.map((email, i) => (
              <EmailCard key={email.id} email={email} index={i} />
            ))}
          </div>
        </div>
      )}

      {!!briefing.groups?.length && (
        <div>
          <Heading icon={<Layers size={13} className="text-sky-400" />} count={counts?.grouped}>
            Grouped &amp; Low Priority
          </Heading>
          <div className="space-y-1.5">
            {briefing.groups.map((group, i) => (
              <GroupRow key={`${group.label}-${i}`} group={group} />
            ))}
          </div>
        </div>
      )}

      {!!briefing.recommended_actions?.length && (
        <div>
          <Heading icon={<ListChecks size={13} className="text-emerald-400" />}>
            Recommended Actions
          </Heading>
          <div className="space-y-1.5">
            {briefing.recommended_actions.map((action) => (
              <ActionRow key={action.priority} action={action} />
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-neutral-600">
            Summarising only reads your mail — nothing here has been archived, replied to or sent.
          </p>
        </div>
      )}
    </div>
  );
}
