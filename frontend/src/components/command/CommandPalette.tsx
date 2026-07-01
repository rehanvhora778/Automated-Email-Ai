import {
  useEffect, useMemo, useRef, useState,
  type ReactNode, type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, LayoutDashboard, Bot, Reply, Inbox, BarChart3, Calendar, Users,
  Bell, Settings as SettingsIcon, User, PenLine, Mail, LogOut, FileText,
  Send, Languages, Wand2, RefreshCw, CornerDownLeft, Command as CommandIcon,
  Sparkles, SpellCheck, AlignLeft, ShieldAlert, Type, Clock,
} from "lucide-react";
import type { ToolAction } from "../../lib/types";
import { cn } from "../../lib/cn";

interface Command {
  id: string;
  label: string;
  group: "Navigation" | "Actions" | "AI Tools";
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: string) => void;
  onCompose: () => void;
  onOpenTool: (action: ToolAction) => void;
  onLinkGmail: () => void;
  onLogout: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onCompose,
  onOpenTool,
  onLinkGmail,
  onLogout,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (view: string) => () => {
      onNavigate(view);
      onOpenChange(false);
    };
    const tool = (action: ToolAction) => () => {
      onOpenTool(action);
      onOpenChange(false);
    };
    return [
      { id: "nav-dashboard", group: "Navigation", label: "Dashboard", icon: <LayoutDashboard size={16} />, keywords: "home overview", run: go("dashboard") },
      { id: "nav-chat", group: "Navigation", label: "AI Workspace", icon: <Bot size={16} />, keywords: "chat assistant", run: go("chat") },
      { id: "nav-agent", group: "Navigation", label: "AI Agent", icon: <Wand2 size={16} />, keywords: "agent automate command run", run: go("agent") },
      { id: "nav-reply", group: "Navigation", label: "Smart Reply", icon: <Reply size={16} />, keywords: "respond reply", run: go("smartReply") },
      { id: "nav-inbox", group: "Navigation", label: "Inbox Summary", icon: <Inbox size={16} />, keywords: "briefing mail", run: go("inbox") },
      { id: "nav-analytics", group: "Navigation", label: "Analytics", icon: <BarChart3 size={16} />, keywords: "stats charts metrics", run: go("analytics") },
      { id: "nav-calendar", group: "Navigation", label: "Calendar", icon: <Calendar size={16} />, keywords: "meetings events schedule", run: go("calendar") },
      { id: "nav-contacts", group: "Navigation", label: "Contacts", icon: <Users size={16} />, keywords: "people company", run: go("contacts") },
      { id: "nav-notifications", group: "Navigation", label: "Notifications", icon: <Bell size={16} />, keywords: "alerts", run: go("notifications") },
      { id: "nav-settings", group: "Navigation", label: "Settings", icon: <SettingsIcon size={16} />, keywords: "preferences config", run: go("settings") },
      { id: "nav-profile", group: "Navigation", label: "Profile", icon: <User size={16} />, keywords: "account me", run: go("profile") },
      { id: "nav-tools", group: "Navigation", label: "AI Tools", icon: <Sparkles size={16} />, keywords: "tools suite grammar summarize", run: go("tools") },

      { id: "act-compose", group: "Actions", label: "Compose new email", icon: <PenLine size={16} />, keywords: "write send new", run: () => { onCompose(); onOpenChange(false); } },
      { id: "act-summarize", group: "Actions", label: "Summarize my inbox", icon: <Inbox size={16} />, keywords: "briefing ai", run: go("inbox") },
      { id: "act-link", group: "Actions", label: "Link Gmail account", icon: <Mail size={16} />, keywords: "connect google", run: () => { onLinkGmail(); onOpenChange(false); } },
      { id: "act-logout", group: "Actions", label: "Log out", icon: <LogOut size={16} />, keywords: "sign out exit", run: () => { onLogout(); onOpenChange(false); } },

      { id: "tool-cover", group: "AI Tools", label: "Write a cover letter", icon: <FileText size={16} />, keywords: "job application", run: tool("cover_letter") },
      { id: "tool-cold", group: "AI Tools", label: "Write a cold email", icon: <Send size={16} />, keywords: "outreach sales", run: tool("cold_email") },
      { id: "tool-translate", group: "AI Tools", label: "Translate an email", icon: <Languages size={16} />, keywords: "language", run: tool("translate") },
      { id: "tool-improve", group: "AI Tools", label: "Improve my writing", icon: <Wand2 size={16} />, keywords: "grammar clarity", run: tool("improve") },
      { id: "tool-rewrite", group: "AI Tools", label: "Rewrite an email", icon: <RefreshCw size={16} />, keywords: "rephrase", run: tool("rewrite") },
      { id: "tool-grammar", group: "AI Tools", label: "Fix grammar", icon: <SpellCheck size={16} />, keywords: "spelling punctuation", run: tool("grammar_fix") },
      { id: "tool-summarize", group: "AI Tools", label: "Summarize text", icon: <AlignLeft size={16} />, keywords: "tldr key points", run: tool("summarize") },
      { id: "tool-phishing", group: "AI Tools", label: "Detect phishing", icon: <ShieldAlert size={16} />, keywords: "scam spam security", run: tool("phishing_detection") },
      { id: "tool-subject", group: "AI Tools", label: "Generate subject lines", icon: <Type size={16} />, keywords: "subject headline", run: tool("subject_generator") },
      { id: "tool-followup", group: "AI Tools", label: "Write a follow-up", icon: <Clock size={16} />, keywords: "nudge reminder", run: tool("follow_up") },
    ];
  }, [onNavigate, onOpenChange, onCompose, onOpenTool, onLinkGmail, onLogout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.keywords ?? "").includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Render grouped, but track a flat running index for keyboard selection.
  let running = -1;
  const groups: Command["group"][] = ["Navigation", "Actions", "AI Tools"];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-[120] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-ink-900/95 shadow-card"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-white/5 px-5 py-4">
              <Search size={18} className="text-neutral-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search commands, pages, AI tools…"
                className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-neutral-600"
                aria-label="Command palette search"
              />
              <kbd className="hidden items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 sm:flex">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-neutral-500">
                  <CommandIcon size={22} className="text-neutral-600" />
                  No results for “{query}”
                </div>
              ) : (
                groups.map((group) => {
                  const items = filtered.filter((c) => c.group === group);
                  if (!items.length) return null;
                  return (
                    <div key={group} className="mb-1">
                      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                        {group}
                      </p>
                      {items.map((c) => {
                        running += 1;
                        const idx = running;
                        const isActive = idx === active;
                        return (
                          <button
                            key={c.id}
                            data-idx={idx}
                            onMouseEnter={() => setActive(idx)}
                            onClick={c.run}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                              isActive ? "bg-white/[0.08] text-white" : "text-neutral-300 hover:bg-white/[0.04]"
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-lg",
                                isActive ? "bg-brand-500/25 text-brand-200" : "bg-white/5 text-neutral-400"
                              )}
                            >
                              {c.icon}
                            </span>
                            <span className="flex-1 font-medium">{c.label}</span>
                            {isActive && (
                              <CornerDownLeft size={14} className="text-neutral-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center justify-between border-t border-white/5 px-5 py-2.5 text-[11px] text-neutral-600">
              <span className="flex items-center gap-1.5">
                <CommandIcon size={12} /> Command palette
              </span>
              <span className="flex items-center gap-3">
                <span>↑↓ navigate</span>
                <span>↵ select</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
