import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Users, Search, Mail, MessageSquare, Clock, Sparkles, Building2 } from "lucide-react";
import { contacts as allContacts } from "../lib/demo";
import { GlassCard } from "../components/ui/GlassCard";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";

export function Contacts({ onCompose }: { onCompose?: () => void }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allContacts;
    return allContacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Users size={24} className="text-brand-400" /> Contacts
          </h1>
          <Badge tone="info">Preview data</Badge>
        </div>
        <p className="mt-2 text-sm text-neutral-500">People you talk to most, with an AI summary of every relationship.</p>
      </motion.div>

      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <Search size={18} className="text-neutral-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people, companies, emails…"
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-600"
        />
        <span className="text-xs text-neutral-600">{filtered.length} people</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((c, i) => (
          <GlassCard key={c.email} delay={i * 0.05} className="p-5">
            <div className="flex items-start gap-4">
              <Avatar name={c.name} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{c.name}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-neutral-500">
                  <Building2 size={12} /> {c.company}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-600">{c.email}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-white tabular-nums">
                  <AnimatedCounter value={c.conversations} />
                </p>
                <p className="text-[10px] uppercase tracking-widest text-neutral-600">threads</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-brand-500/15 bg-brand-500/[0.06] p-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-300">
                <Sparkles size={12} /> AI summary
              </p>
              <p className="text-sm leading-relaxed text-neutral-300">{c.summary}</p>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
              <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Clock size={13} /> Last contact {c.lastContact}
              </span>
              <div className="flex gap-1.5">
                <button className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/5 hover:text-white">
                  <MessageSquare size={13} /> Threads
                </button>
                <button
                  onClick={onCompose}
                  className="flex items-center gap-1.5 rounded-xl bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                >
                  <Mail size={13} /> Email
                </button>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
