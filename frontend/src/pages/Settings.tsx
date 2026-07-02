import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon, Palette, Cpu, Plug, BellRing, ShieldCheck,
  Mail, HardDrive, KeyRound, Check, Monitor, Globe, LogOut, Smartphone,
} from "lucide-react";
import { GlassCard } from "../components/ui/GlassCard";
import { Toggle } from "../components/ui/Toggle";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { cn } from "../lib/cn";

function Row({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-neutral-300">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">{title}</p>
        {desc && <p className="text-xs text-neutral-500">{desc}</p>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
    >
      {options.map((o) => <option key={o} value={o} className="bg-ink-900">{o}</option>)}
    </select>
  );
}

export function Settings({ userEmail, onLinkGmail }: { userEmail?: string; onLinkGmail?: () => void }) {
  const [tab, setTab] = useState("appearance");
  const [theme, setTheme] = useState("Dark");
  const [accent, setAccent] = useState("Indigo");
  const [language, setLanguage] = useState("English");
  const [model, setModel] = useState("Mistral Medium");
  const [notif, setNotif] = useState({ aiFinished: true, emailSent: true, mentions: false, weekly: true });

  const accents = [
    { name: "Indigo", class: "from-indigo-500 to-blue-500" },
    { name: "Violet", class: "from-violet-500 to-purple-500" },
    { name: "Emerald", class: "from-emerald-500 to-teal-500" },
    { name: "Rose", class: "from-rose-500 to-pink-500" },
  ];

  const tabs = [
    { key: "appearance", label: "Appearance", icon: <Palette size={15} /> },
    { key: "ai", label: "AI", icon: <Cpu size={15} /> },
    { key: "connections", label: "Connections", icon: <Plug size={15} /> },
    { key: "notifications", label: "Notifications", icon: <BellRing size={15} /> },
    { key: "security", label: "Security", icon: <ShieldCheck size={15} /> },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <SettingsIcon size={24} className="text-brand-400" /> Settings
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Personalise your workspace, AI and connected accounts.</p>
      </motion.div>

      <Tabs items={tabs} active={tab} onChange={setTab} />

      {tab === "appearance" && (
        <GlassCard className="space-y-4 p-6">
          <Row icon={<Monitor size={18} />} title="Theme" desc="Premium dark theme is optimised for long sessions." action={<Select value={theme} onChange={setTheme} options={["Dark", "Midnight", "System"]} />} />
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <p className="font-semibold text-white">Accent color</p>
            <p className="mb-3 text-xs text-neutral-500">Used across gradients and highlights.</p>
            <div className="flex gap-3">
              {accents.map((a) => (
                <button
                  key={a.name}
                  onClick={() => setAccent(a.name)}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg transition-transform hover:scale-110",
                    a.class,
                    accent === a.name && "ring-2 ring-white ring-offset-2 ring-offset-ink-900"
                  )}
                  aria-label={a.name}
                >
                  {accent === a.name && <Check size={16} className="text-white" />}
                </button>
              ))}
            </div>
          </div>
          <Row icon={<Globe size={18} />} title="Language" action={<Select value={language} onChange={setLanguage} options={["English", "Español", "Français", "Deutsch", "हिन्दी"]} />} />
        </GlassCard>
      )}

      {tab === "ai" && (
        <GlassCard className="space-y-4 p-6">
          <Row icon={<Cpu size={18} />} title="AI model" desc="The engine powering drafts, replies and summaries." action={<Select value={model} onChange={setModel} options={["Mistral Medium", "Mistral Large", "Mistral Small"]} />} />
          <Row icon={<KeyRound size={18} />} title="API key" desc="Managed securely on the server (backend .env)." action={<Badge tone="success"><Check size={11} /> Configured</Badge>} />
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-2 font-semibold text-white">Custom API key (optional)</p>
            <input
              type="password"
              placeholder="sk-•••••••••••••••••••••"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-white/25"
            />
            <p className="mt-2 text-xs text-neutral-600">Leave blank to use the workspace default.</p>
          </div>
        </GlassCard>
      )}

      {tab === "connections" && (
        <GlassCard className="space-y-4 p-6">
          <Row
            icon={<Mail size={18} className="text-rose-400" />}
            title="Gmail"
            desc={userEmail ? `Signed in as ${userEmail}` : "Send and read email"}
            action={<Button variant="glass" onClick={onLinkGmail}><Mail size={15} /> Link / Re-link</Button>}
          />
          <Row icon={<HardDrive size={18} className="text-emerald-400" />} title="Google Drive" desc="Attach files from Drive." action={<Button variant="glass"><HardDrive size={15} /> Connect</Button>} />
        </GlassCard>
      )}

      {tab === "notifications" && (
        <GlassCard className="space-y-4 p-6">
          <Row icon={<BellRing size={18} />} title="AI finished tasks" desc="When a draft or summary is ready." action={<Toggle checked={notif.aiFinished} onChange={(v) => setNotif((n) => ({ ...n, aiFinished: v }))} />} />
          <Row icon={<Mail size={18} />} title="Email sent" desc="Confirmation when mail is delivered." action={<Toggle checked={notif.emailSent} onChange={(v) => setNotif((n) => ({ ...n, emailSent: v }))} />} />
          <Row icon={<Globe size={18} />} title="Mentions" action={<Toggle checked={notif.mentions} onChange={(v) => setNotif((n) => ({ ...n, mentions: v }))} />} />
          <Row icon={<BellRing size={18} />} title="Weekly digest" desc="A Monday summary of last week." action={<Toggle checked={notif.weekly} onChange={(v) => setNotif((n) => ({ ...n, weekly: v }))} />} />
        </GlassCard>
      )}

      {tab === "security" && (
        <GlassCard className="space-y-4 p-6">
          <Row icon={<ShieldCheck size={18} className="text-emerald-400" />} title="Two-factor authentication" desc="Add an extra layer of security." action={<Badge tone="warning">Off</Badge>} />
          <Row icon={<KeyRound size={18} />} title="Change password" action={<Button variant="glass">Update</Button>} />
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-3 font-semibold text-white">Active sessions</p>
            <div className="space-y-3">
              {[
                { icon: <Monitor size={16} />, name: "Windows · Chrome", meta: "This device · active now", current: true },
                { icon: <Smartphone size={16} />, name: "iPhone · Safari", meta: "Mumbai · 2h ago", current: false },
              ].map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-neutral-300">{s.icon}</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{s.name}</p>
                    <p className="text-xs text-neutral-500">{s.meta}</p>
                  </div>
                  {s.current ? <Badge tone="success">Current</Badge> : (
                    <button className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300"><LogOut size={13} /> Revoke</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
