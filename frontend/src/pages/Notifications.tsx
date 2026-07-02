import { useMemo, useState, type ElementType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, Check, Mail, MailWarning, RefreshCw, Inbox as InboxIcon,
  Users, Tag, Megaphone, MessagesSquare, Flag,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGmailNotifications } from "../lib/hooks";
import { markNotificationsRead, runInboxAction } from "../lib/api";
import type { GmailNotification, NotificationsResponse } from "../lib/types";
import { timeAgo } from "../lib/time";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Skeleton } from "../components/ui/Skeleton";
import { Avatar } from "../components/ui/Avatar";
import { cn } from "../lib/cn";

const categoryMeta: Record<string, { icon: ElementType; color: string }> = {
  primary: { icon: InboxIcon, color: "text-brand-300 bg-brand-500/15" },
  social: { icon: Users, color: "text-emerald-300 bg-emerald-500/15" },
  promotions: { icon: Tag, color: "text-rose-300 bg-rose-500/15" },
  updates: { icon: Megaphone, color: "text-amber-300 bg-amber-500/15" },
  forums: { icon: MessagesSquare, color: "text-sky-300 bg-sky-500/15" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "important", label: "Important" },
  { key: "primary", label: "Primary" },
  { key: "updates", label: "Updates" },
  { key: "social", label: "Social" },
  { key: "promotions", label: "Promotions" },
];

export function Notifications({
  userId,
  onLinkGmail,
}: {
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useGmailNotifications(userId);
  const queryKey = ["gmail-notifications", userId];

  const items = data?.notifications ?? [];
  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "important") return items.filter((n) => n.important);
    return items.filter((n) => n.category === filter);
  }, [items, filter]);

  const invalidateUnread = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["inbox-summary", userId] });
  };

  const readAllMut = useMutation({
    mutationFn: () => markNotificationsRead(userId as string, items.map((n) => n.id)),
    onMutate: () => {
      qc.setQueryData<NotificationsResponse>(queryKey, (old) =>
        old ? { ...old, notifications: [] } : old
      );
    },
    onSuccess: () => {
      toast.success(`Marked ${items.length} email${items.length === 1 ? "" : "s"} as read`);
      invalidateUnread();
    },
    onError: (err: any) => {
      invalidateUnread();
      if (err?.response?.status === 403) toast.error("Re-link Gmail to enable mark-as-read");
      else toast.error(err?.response?.data?.detail || "Couldn't mark as read");
    },
  });

  const readOneMut = useMutation({
    mutationFn: (id: string) => runInboxAction(userId as string, id, "mark_read"),
    onMutate: (id) => {
      qc.setQueryData<NotificationsResponse>(queryKey, (old) =>
        old ? { ...old, notifications: old.notifications.filter((n) => n.id !== id) } : old
      );
    },
    onSuccess: () => invalidateUnread(),
    onError: (err: any) => {
      invalidateUnread();
      if (err?.response?.status === 403) toast.error("Re-link Gmail to enable mark-as-read");
      else toast.error(err?.response?.data?.detail || "Couldn't mark as read");
    },
  });

  const tabItems = FILTERS.map((f) => ({
    ...f,
    count:
      f.key === "all"
        ? items.length || undefined
        : f.key === "important"
          ? items.filter((n) => n.important).length || undefined
          : items.filter((n) => n.category === f.key).length || undefined,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              <Bell size={24} className="text-brand-400" /> Notifications
            </h1>
            {items.length > 0 && <Badge tone="brand">{items.length} unread</Badge>}
          </div>
          <p className="mt-2 text-sm text-neutral-500">
            Your unread Gmail, newest first. Click one to mark it read.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            title="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => readAllMut.mutate()}
            disabled={items.length === 0 || readAllMut.isPending}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <Check size={14} /> Mark all read
          </button>
        </div>
      </motion.div>

      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <GlassCard className="p-4">
          <ErrorState
            title="Couldn't load notifications"
            message={(error as Error)?.message}
            onRetry={() => refetch()}
          />
        </GlassCard>
      ) : !data?.gmail_linked ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<Mail size={26} />}
            title="Connect Gmail to see notifications"
            description="Link your Gmail account and your unread mail will show up here as notifications."
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
            description="Your Gmail was linked with send-only permission. Re-link once so unread mail can be read."
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
          <Tabs items={tabItems} active={filter} onChange={setFilter} />

          <div className="space-y-2.5">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-neutral-500">
                <Bell size={22} className="text-neutral-600" /> You're all caught up.
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filtered.map((n: GmailNotification, i) => {
                  const meta = categoryMeta[n.category] ?? categoryMeta.primary;
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={n.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.2 } }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      onClick={() => readOneMut.mutate(n.id)}
                      title="Mark as read"
                      className={cn(
                        "flex cursor-pointer items-start gap-3.5 rounded-2xl border p-4 transition-all",
                        "border-brand-500/20 bg-brand-500/[0.05] hover:bg-brand-500/[0.09]"
                      )}
                    >
                      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", meta.color)}>
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-white">{n.sender_name}</p>
                          {n.important && <Flag size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
                          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" />
                        </div>
                        <p className="mt-0.5 truncate text-sm font-medium text-neutral-200">{n.subject}</p>
                        {n.snippet && <p className="mt-0.5 truncate text-xs text-neutral-500">{n.snippet}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-xs text-neutral-600">{timeAgo(n.time_ms)}</span>
                        <Avatar name={n.sender_name} size={22} className="rounded-lg" />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </>
      )}
    </div>
  );
}
