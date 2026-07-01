import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Star, Mail, MailOpen, Archive, Trash2, Flag, RefreshCw, Inbox as InboxIcon, MailWarning,
} from "lucide-react";
import { toast } from "sonner";
import { useInboxMessages } from "../../lib/hooks";
import { runInboxAction } from "../../lib/api";
import type { InboxActionType, InboxMessage, InboxMessagesResponse } from "../../lib/types";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Avatar } from "../ui/Avatar";
import { cn } from "../../lib/cn";

const ACTION_TOAST: Record<InboxActionType, string> = {
  archive: "Archived",
  trash: "Moved to Trash",
  mark_important: "Marked important",
  mark_unimportant: "Removed important",
  mark_read: "Marked as read",
  mark_unread: "Marked as unread",
  star: "Starred",
  unstar: "Unstarred",
};

/** Apply an action to the cached list so the UI updates before the request returns. */
function applyOptimistic(
  old: InboxMessagesResponse | undefined,
  id: string,
  action: InboxActionType
): InboxMessagesResponse | undefined {
  if (!old) return old;
  if (action === "archive" || action === "trash") {
    return { ...old, messages: old.messages.filter((m) => m.id !== id) };
  }
  return {
    ...old,
    messages: old.messages.map((m) => {
      if (m.id !== id) return m;
      switch (action) {
        case "mark_read": return { ...m, unread: false };
        case "mark_unread": return { ...m, unread: true };
        case "star": return { ...m, starred: true };
        case "unstar": return { ...m, starred: false };
        case "mark_important": return { ...m, important: true };
        case "mark_unimportant": return { ...m, important: false };
        default: return m;
      }
    }),
  };
}

function fmtDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function IconBtn({
  onClick, title, active, children, danger,
}: {
  onClick: () => void; title: string; active?: boolean; children: ReactNode; danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        active ? "text-amber-400" : "text-neutral-500 hover:text-white",
        danger ? "hover:bg-rose-500/15 hover:text-rose-300" : "hover:bg-white/10"
      )}
    >
      {children}
    </button>
  );
}

export function InboxMessageList({
  userId,
  tab,
  onLinkGmail,
}: {
  userId?: string;
  tab: string;
  onLinkGmail?: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useInboxMessages(userId, tab);
  const queryKey = ["inbox-messages", userId, tab];
  const [bulkBusy, setBulkBusy] = useState(false);

  const actionMut = useMutation<
    void,
    any,
    { id: string; action: InboxActionType },
    { prev?: InboxMessagesResponse }
  >({
    mutationFn: ({ id, action }) => runInboxAction(userId as string, id, action),
    onMutate: async ({ id, action }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<InboxMessagesResponse>(queryKey);
      qc.setQueryData<InboxMessagesResponse>(queryKey, (old) => applyOptimistic(old, id, action));
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      if (err?.response?.status === 403) {
        toast.error("Re-link Gmail to enable inbox actions");
      } else {
        toast.error(err?.response?.data?.detail || "Action failed");
      }
    },
    onSuccess: (_d, { action }) => toast.success(ACTION_TOAST[action]),
  });

  const act = (id: string, action: InboxActionType) => actionMut.mutate({ id, action });

  const messages = data?.messages ?? [];
  const canBulk = (tab === "promotions" || tab === "newsletters") && messages.length > 0;

  const bulkArchive = async () => {
    const ids = messages.map((m) => m.id);
    if (!ids.length) return;
    setBulkBusy(true);
    qc.setQueryData<InboxMessagesResponse>(queryKey, (old) => (old ? { ...old, messages: [] } : old));
    let ok = 0;
    for (const id of ids) {
      try {
        await runInboxAction(userId as string, id, "archive");
        ok += 1;
      } catch {
        /* reconcile below */
      }
    }
    setBulkBusy(false);
    if (ok) toast.success(`Archived ${ok} email${ok === 1 ? "" : "s"}`);
    else toast.error("Couldn't archive — re-link Gmail for access");
    refetch();
  };

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3.5">
            <Skeleton className="h-10 w-10 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <GlassCard className="p-4">
        <ErrorState title="Couldn't load messages" message={(error as Error)?.message} onRetry={() => refetch()} />
      </GlassCard>
    );
  }

  if (data && !data.gmail_linked) {
    return (
      <GlassCard className="p-2">
        <EmptyState
          icon={<Mail size={26} />}
          title="Connect Gmail to see this tab"
          description="Link your Gmail account to browse and manage messages by category."
          action={onLinkGmail ? <Button onClick={onLinkGmail}><Mail size={16} /> Connect Gmail</Button> : undefined}
        />
      </GlassCard>
    );
  }

  if (data?.needs_reauth) {
    return (
      <GlassCard className="p-2">
        <EmptyState
          icon={<MailWarning size={26} />}
          title="Re-link Gmail for full access"
          description="Grant read + modify access so you can browse tabs and archive, delete, star and label messages."
          action={onLinkGmail ? <Button onClick={onLinkGmail}><RefreshCw size={16} /> Re-link Gmail</Button> : undefined}
        />
      </GlassCard>
    );
  }

  if (!messages.length) {
    return (
      <GlassCard className="p-2">
        <EmptyState icon={<InboxIcon size={26} />} title="Nothing here" description={`No emails found in ${tab}.`} />
      </GlassCard>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-neutral-500">{messages.length} messages</p>
        <div className="flex items-center gap-2">
          {canBulk && (
            <button
              onClick={bulkArchive}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <Archive size={13} /> {bulkBusy ? "Archiving…" : "Archive all"}
            </button>
          )}
          <button
            onClick={() => refetch()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            title="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {messages.map((m: InboxMessage) => (
          <motion.div
            key={m.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.2 } }}
            className={cn(
              "group flex items-start gap-3 rounded-2xl border p-3.5 transition-colors",
              m.unread
                ? "border-white/10 bg-white/[0.045]"
                : "border-white/5 bg-white/[0.015] hover:bg-white/[0.04]"
            )}
          >
            <IconBtn
              onClick={() => act(m.id, m.starred ? "unstar" : "star")}
              title={m.starred ? "Unstar" : "Star"}
              active={m.starred}
            >
              <Star size={16} className={m.starred ? "fill-amber-400" : ""} />
            </IconBtn>

            <Avatar name={m.sender_name} size={40} />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("truncate text-sm", m.unread ? "font-bold text-white" : "font-medium text-neutral-300")}>
                  {m.sender_name}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{fmtDate(m.date)}</span>
              </div>
              <p className={cn("flex items-center gap-1.5 truncate text-sm", m.unread ? "font-medium text-neutral-100" : "text-neutral-400")}>
                {m.important && <Flag size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
                {m.subject}
              </p>
              <p className="truncate text-xs text-neutral-500">{m.snippet}</p>

              {/* Per-message actions */}
              <div className="mt-2 flex items-center gap-0.5 sm:opacity-70 sm:transition-opacity sm:group-hover:opacity-100">
                <IconBtn
                  onClick={() => act(m.id, m.unread ? "mark_read" : "mark_unread")}
                  title={m.unread ? "Mark as read" : "Mark as unread"}
                >
                  {m.unread ? <MailOpen size={15} /> : <Mail size={15} />}
                </IconBtn>
                <IconBtn
                  onClick={() => act(m.id, m.important ? "mark_unimportant" : "mark_important")}
                  title={m.important ? "Remove important" : "Mark important"}
                  active={m.important}
                >
                  <Flag size={15} className={m.important ? "fill-amber-400" : ""} />
                </IconBtn>
                <IconBtn onClick={() => act(m.id, "archive")} title="Archive">
                  <Archive size={15} />
                </IconBtn>
                <IconBtn onClick={() => act(m.id, "trash")} title="Delete" danger>
                  <Trash2 size={15} />
                </IconBtn>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
