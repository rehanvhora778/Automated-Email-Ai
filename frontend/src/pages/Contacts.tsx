import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Users, Search, Mail, Clock, Building2, Send, Inbox as InboxIcon,
  MailWarning, RefreshCw,
} from "lucide-react";
import { useGmailContacts } from "../lib/hooks";
import { timeAgo } from "../lib/time";
import { GlassCard } from "../components/ui/GlassCard";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Skeleton } from "../components/ui/Skeleton";

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-3xl" />
      ))}
    </div>
  );
}

export function Contacts({
  userId,
  onCompose,
  onLinkGmail,
}: {
  userId?: string;
  onCompose?: () => void;
  onLinkGmail?: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, isLoading, isError, error, refetch, isFetching } = useGmailContacts(userId);

  const all = data?.contacts ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q)
    );
  }, [all, query]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Users size={24} className="text-brand-400" /> Contacts
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
          The people in your recent Gmail — who you write to and who writes to you.
        </p>
      </motion.div>

      {isLoading ? (
        <LoadingGrid />
      ) : isError ? (
        <GlassCard className="p-4">
          <ErrorState
            title="Couldn't load contacts"
            message={(error as Error)?.message}
            onRetry={() => refetch()}
          />
        </GlassCard>
      ) : !data?.gmail_linked ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<Mail size={26} />}
            title="Connect Gmail to see your contacts"
            description="Link your Gmail account and your real contacts will be built from the people you actually email."
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
            description="Your Gmail was linked with send-only permission. Re-link once so contacts can be read from your mail."
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
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <Search size={18} className="text-neutral-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, domains, emails…"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-600"
            />
            <span className="text-xs text-neutral-600">{filtered.length} people</span>
          </div>

          {filtered.length === 0 ? (
            <GlassCard className="p-2">
              <EmptyState
                icon={<Users size={24} />}
                title={query ? "No matches" : "No contacts yet"}
                description={
                  query
                    ? "Nobody in your recent mail matches that search."
                    : "Send or receive a few emails and your contacts will appear here."
                }
              />
            </GlassCard>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((c, i) => (
                <GlassCard key={c.email} delay={Math.min(i * 0.04, 0.4)} className="p-5">
                  <div className="flex items-start gap-4">
                    <Avatar name={c.name} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-white">{c.name}</p>
                        {c.sent > 0 && <Badge tone="success">You replied</Badge>}
                      </div>
                      <p className="flex items-center gap-1.5 truncate text-xs text-neutral-500">
                        <Building2 size={12} /> {c.domain}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-neutral-600">{c.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-white tabular-nums">
                        <AnimatedCounter value={c.count} />
                      </p>
                      <p className="text-[10px] uppercase tracking-widest text-neutral-600">emails</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-4 text-xs text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <InboxIcon size={13} className="text-cyan-400" /> {c.received} received
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Send size={13} className="text-brand-400" /> {c.sent} sent
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                    <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <Clock size={13} /> Last contact {timeAgo(c.last_ms)}
                    </span>
                    <button
                      onClick={onCompose}
                      className="flex items-center gap-1.5 rounded-xl bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                    >
                      <Mail size={13} /> Email
                    </button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
