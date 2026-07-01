import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Inbox as InboxIcon, Sparkles, Star, Tag, Newspaper, Wallet, Plane, Users, Bell,
} from "lucide-react";
import type { InboxTab } from "../lib/types";
import { Tabs } from "../components/ui/Tabs";
import { InboxSummary } from "../components/dashboard/InboxSummary";
import { InboxMessageList } from "../components/inbox/InboxMessageList";

const TABS: { key: InboxTab; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <Sparkles size={14} /> },
  { key: "important", label: "Important", icon: <Star size={14} /> },
  { key: "promotions", label: "Promotions", icon: <Tag size={14} /> },
  { key: "newsletters", label: "Newsletters", icon: <Newspaper size={14} /> },
  { key: "finance", label: "Finance", icon: <Wallet size={14} /> },
  { key: "travel", label: "Travel", icon: <Plane size={14} /> },
  { key: "social", label: "Social", icon: <Users size={14} /> },
  { key: "updates", label: "Updates", icon: <Bell size={14} /> },
];

export function InboxCenter({
  userId,
  onLinkGmail,
}: {
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const [tab, setTab] = useState<InboxTab>("overview");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <InboxIcon size={24} className="text-brand-400" /> Inbox
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          AI briefing plus category tabs — archive, star, label and clean up in one click.
        </p>
      </motion.div>

      <Tabs items={TABS} active={tab} onChange={(k) => setTab(k as InboxTab)} />

      {tab === "overview" ? (
        <InboxSummary userId={userId} onLinkGmail={onLinkGmail} />
      ) : (
        <InboxMessageList userId={userId} tab={tab} onLinkGmail={onLinkGmail} />
      )}
    </div>
  );
}
