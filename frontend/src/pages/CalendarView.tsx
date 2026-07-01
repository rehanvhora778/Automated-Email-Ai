import { motion } from "framer-motion";
import { Calendar, Clock, Bell, ChevronRight, Video } from "lucide-react";
import { meetings, type DemoMeeting } from "../lib/demo";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { cn } from "../lib/cn";

function MeetingRow({ m, delay }: { m: DemoMeeting; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="group flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/15 hover:bg-white/[0.05]"
    >
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg", m.accent)}>
        <Video size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{m.title}</p>
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Clock size={12} /> {m.time}
        </p>
      </div>
      <div className="flex -space-x-2">
        {m.attendees.map((a) => (
          <Avatar key={a} name={a} size={28} className="rounded-xl ring-2 ring-ink-900" />
        ))}
      </div>
      <ChevronRight size={16} className="shrink-0 text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
    </motion.div>
  );
}

export function CalendarView() {
  const today = meetings.filter((m) => m.day === "today");
  const tomorrow = meetings.filter((m) => m.day === "tomorrow");
  const week = meetings.filter((m) => m.day === "week");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Calendar size={24} className="text-brand-400" /> Calendar
          </h1>
          <Badge tone="info">Preview data</Badge>
        </div>
        <p className="mt-2 text-sm text-neutral-500">Your meetings and reminders, detected from mail and synced calendars.</p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <SectionHeader title="Today" subtitle={`${today.length} events`} icon={<Calendar size={16} />} />
            <div className="space-y-3">
              {today.map((m, i) => <MeetingRow key={m.title} m={m} delay={i * 0.05} />)}
            </div>
          </div>
          <div>
            <SectionHeader title="Tomorrow" subtitle={`${tomorrow.length} events`} icon={<Calendar size={16} />} />
            <div className="space-y-3">
              {tomorrow.map((m, i) => <MeetingRow key={m.title} m={m} delay={i * 0.05} />)}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <SectionHeader title="This Week" icon={<Clock size={16} />} />
            <GlassCard className="p-5">
              <div className="space-y-4">
                {[...today, ...tomorrow, ...week].map((m, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <span className={cn("h-2.5 w-2.5 rounded-full bg-gradient-to-br", m.accent)} />
                      {i < today.length + tomorrow.length + week.length - 1 && <span className="mt-1 h-8 w-px bg-white/10" />}
                    </div>
                    <div className="-mt-1 min-w-0">
                      <p className="truncate text-sm font-medium text-white">{m.title}</p>
                      <p className="text-xs text-neutral-500">{m.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          <GlassCard glow className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Bell size={16} className="text-amber-400" /> Next reminder
            </div>
            <p className="mt-3 text-lg font-bold text-white">{today[0]?.title ?? "No meetings"}</p>
            <p className="text-sm text-neutral-400">{today[0]?.time ?? "You're all clear today."}</p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
