import { useMemo, useState, type ElementType } from "react";
import { motion } from "framer-motion";
import {
  Bell, Sparkles, Send, CalendarClock, AtSign, Settings2, Check,
} from "lucide-react";
import { notifications as allNotifications, type DemoNotification } from "../lib/demo";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { cn } from "../lib/cn";

const kindMeta: Record<DemoNotification["kind"], { icon: ElementType; color: string }> = {
  ai: { icon: Sparkles, color: "text-brand-300 bg-brand-500/15" },
  sent: { icon: Send, color: "text-emerald-300 bg-emerald-500/15" },
  meeting: { icon: CalendarClock, color: "text-amber-300 bg-amber-500/15" },
  mention: { icon: AtSign, color: "text-sky-300 bg-sky-500/15" },
  system: { icon: Settings2, color: "text-neutral-300 bg-white/10" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mention", label: "Mentions" },
  { key: "ai", label: "AI Finished" },
  { key: "sent", label: "Email Sent" },
  { key: "meeting", label: "Meetings" },
];

export function Notifications() {
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState<DemoNotification[]>(allNotifications);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => n.unread);
    return items.filter((n) => n.kind === filter);
  }, [items, filter]);

  const unreadCount = items.filter((n) => n.unread).length;
  const markAllRead = () => setItems((prev) => prev.map((n) => ({ ...n, unread: false })));

  const tabItems = FILTERS.map((f) => ({
    ...f,
    count: f.key === "unread" ? unreadCount : undefined,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              <Bell size={24} className="text-brand-400" /> Notifications
            </h1>
            {unreadCount > 0 && <Badge tone="brand">{unreadCount} new</Badge>}
          </div>
          <p className="mt-2 text-sm text-neutral-500">Everything your assistant did and everything that needs you.</p>
        </div>
        <button
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          <Check size={14} /> Mark all read
        </button>
      </motion.div>

      <Tabs items={tabItems} active={filter} onChange={setFilter} />

      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-neutral-500">
            <Bell size={22} className="text-neutral-600" /> You're all caught up.
          </div>
        ) : (
          filtered.map((n, i) => {
            const meta = kindMeta[n.kind];
            const Icon = meta.icon;
            return (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, unread: false } : x)))}
                className={cn(
                  "flex cursor-pointer items-start gap-3.5 rounded-2xl border p-4 transition-all",
                  n.unread
                    ? "border-brand-500/20 bg-brand-500/[0.05] hover:bg-brand-500/[0.09]"
                    : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
                )}
              >
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", meta.color)}>
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-white">{n.title}</p>
                    {n.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" />}
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-400">{n.detail}</p>
                </div>
                <span className="shrink-0 text-xs text-neutral-600">{n.time}</span>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
