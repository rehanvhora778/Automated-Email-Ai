import { motion } from "framer-motion";
import {
  Mail, Star, Send, Inbox, Sparkles, HardDrive, Zap, Check, BadgeCheck,
} from "lucide-react";
import { useInboxSummary } from "../lib/hooks";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatsCard } from "../components/dashboard/StatsCard";
import { RadialScore } from "../components/ui/RadialScore";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";

export function Profile({
  userEmail,
  userId,
  onLinkGmail,
}: {
  userEmail?: string;
  userId?: string;
  onLinkGmail?: () => void;
}) {
  const { data } = useInboxSummary(userId);
  const name = data?.user_name || userEmail?.split("@")[0] || "there";
  const gmailLinked = !!data?.gmail_linked && !data?.needs_reauth;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Hero */}
      <GlassCard glow className="overflow-hidden">
        <div className="h-24 bg-brand-gradient opacity-80" />
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end">
          <div className="-mt-16 flex items-end gap-4">
            <div className="rounded-[1.75rem] ring-4 ring-ink-900">
              <Avatar name={name} size={88} className="rounded-[1.5rem]" />
            </div>
          </div>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              {name} <BadgeCheck size={20} className="text-brand-400" />
            </h1>
            <p className="text-sm text-neutral-500">{userEmail}</p>
          </div>
          <Badge tone="brand" className="self-start px-3 py-1 text-xs sm:self-auto">
            <Sparkles size={12} /> Pro plan
          </Badge>
        </div>
      </GlassCard>

      {/* Stats */}
      <div>
        <SectionHeader title="Statistics" icon={<Zap size={16} />} />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatsCard icon={<Send size={20} />} label="Emails Sent" value={182} description="all time" accent="from-indigo-500/40 to-blue-500/30" />
          <StatsCard icon={<Inbox size={20} />} label="Emails Processed" value={640} description="analyzed by AI" accent="from-sky-500/40 to-cyan-500/30" delay={0.05} />
          <StatsCard icon={<Sparkles size={20} />} label="AI Actions" value={128} description="drafts & summaries" accent="from-violet-500/40 to-purple-500/30" delay={0.1} />
          <StatsCard icon={<Star size={20} />} label="Unread" value={data?.stats?.unread ?? 23} description={data?.stats ? "live" : "preview"} accent="from-amber-500/40 to-orange-500/30" delay={0.15} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* AI usage */}
        <GlassCard className="flex flex-col items-center p-6">
          <p className="mb-4 self-start text-sm font-bold uppercase tracking-widest text-neutral-400">AI Usage</p>
          <RadialScore value={68} label="of monthly quota" suffix="%" />
          <p className="mt-4 text-center text-xs text-neutral-500">2,040 of 3,000 AI credits used this month.</p>
        </GlassCard>

        {/* Storage */}
        <GlassCard className="space-y-5 p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-neutral-400">Storage</p>
          <div className="flex items-center gap-3">
            <HardDrive size={20} className="text-brand-400" />
            <span className="text-2xl font-bold text-white">2.4 GB</span>
            <span className="text-sm text-neutral-500">of 15 GB</span>
          </div>
          <ProgressBar value={2.4} max={15} accent="from-brand-500 to-fuchsia-500" />
          <div className="space-y-3 pt-1 text-sm">
            <ProgressBar label="Attachments" hint="1.2 GB" value={1.2} max={15} accent="from-indigo-500 to-blue-500" />
            <ProgressBar label="Resumes & docs" hint="0.8 GB" value={0.8} max={15} accent="from-emerald-500 to-teal-500" delay={0.1} />
            <ProgressBar label="Cached mail" hint="0.4 GB" value={0.4} max={15} accent="from-amber-500 to-orange-500" delay={0.2} />
          </div>
        </GlassCard>

        {/* Connected accounts */}
        <GlassCard className="space-y-3 p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-neutral-400">Connected Accounts</p>
          <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5"><Mail size={16} className="text-rose-400" /></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Gmail</p>
              <p className="text-xs text-neutral-500">{gmailLinked ? "Connected" : "Not linked"}</p>
            </div>
            {gmailLinked ? <Badge tone="success"><Check size={11} /> Live</Badge> : (
              <Button variant="glass" onClick={onLinkGmail} className="px-3 py-1.5 text-xs">Link</Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5"><HardDrive size={16} className="text-emerald-400" /></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Drive</p>
              <p className="text-xs text-neutral-500">Preview</p>
            </div>
            <Button variant="glass" className="px-3 py-1.5 text-xs">Connect</Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
