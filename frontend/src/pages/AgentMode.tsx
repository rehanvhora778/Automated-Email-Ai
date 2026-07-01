import { useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wand2, Brain, Inbox, BarChart3, User, Calendar, PenLine, Archive, Check,
  Loader2, Send, Copy, Sparkles, CornerDownLeft, Square, Mail, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { streamAgent } from "../lib/api";
import type { AgentEvent, AgentStep } from "../lib/types";
import { GlassCard } from "../components/ui/GlassCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Markdown } from "../components/ui/Markdown";
import { ErrorState } from "../components/ui/ErrorState";
import { cn } from "../lib/cn";

const STEP_ICON: Record<string, ReactNode> = {
  think: <Brain size={16} />,
  read: <Inbox size={16} />,
  analyze: <BarChart3 size={16} />,
  contact: <User size={16} />,
  calendar: <Calendar size={16} />,
  draft: <PenLine size={16} />,
  archive: <Archive size={16} />,
  done: <Check size={16} />,
};

const EXAMPLES = [
  "Summarize my unread emails",
  "Archive all promotions",
  "Draft a proposal email to Acme Inc.",
  "Write a reply thanking John for the update",
];

export function AgentMode({
  userId,
  onSendDraft,
  onLinkGmail,
}: {
  userId?: string;
  onSendDraft: (subject: string, body: string) => void;
  onLinkGmail?: () => void;
}) {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AgentEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (cmd: string) => {
    const text = cmd.trim();
    if (!text || running) return;
    setRunning(true);
    setStatusMsg("Thinking…");
    setSteps([]);
    setResult(null);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAgent(
        { user_id: userId, command: text },
        (e) => {
          if (e.type === "status") setStatusMsg(e.message || "");
          else if (e.type === "plan") {
            setStatusMsg("");
            setSteps((e.steps || []).map((s) => ({ ...s, state: "pending" })));
          } else if (e.type === "step") {
            setSteps((prev) =>
              prev.map((s) =>
                s.key === e.key ? { ...s, state: e.state === "done" ? "done" : "active", detail: e.detail ?? s.detail } : s
              )
            );
          } else if (e.type === "result") {
            setResult(e);
          } else if (e.type === "error") {
            setError(e.message || "Something went wrong");
          }
        },
        controller.signal
      );
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(err?.message || "Agent run failed");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const draft = result?.draft;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Wand2 size={24} className="text-brand-400" /> AI Agent
          </h1>
          <Badge tone="brand"><Sparkles size={11} /> Autonomous</Badge>
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          Give a command in plain English. The agent reads your inbox, summarizes, archives and drafts — then hands drafts to you for a final review before sending.
        </p>
      </motion.div>

      {/* Command box */}
      <GlassCard className="p-4">
        <div className="flex items-end gap-3">
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(command);
              }
            }}
            rows={2}
            placeholder="e.g. Summarize my unread emails and draft a reply to the most urgent one"
            className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          {running ? (
            <Button variant="danger" onClick={stop} className="shrink-0">
              <Square size={14} className="fill-current" /> Stop
            </Button>
          ) : (
            <Button onClick={() => run(command)} disabled={!command.trim()} className="shrink-0">
              <Send size={15} /> Run
            </Button>
          )}
        </div>
      </GlassCard>

      {/* Example chips (only before first run) */}
      {!steps.length && !running && !result && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => { setCommand(ex); run(ex); }}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-neutral-300 transition-all hover:border-white/20 hover:text-white"
            >
              <CornerDownLeft size={12} className="text-neutral-500" /> {ex}
            </button>
          ))}
        </div>
      )}

      {/* Thinking shimmer before the plan arrives */}
      {running && statusMsg && !steps.length && (
        <GlassCard className="flex items-center gap-3 p-5">
          <Loader2 size={18} className="animate-spin text-brand-400" />
          <span className="text-sm text-neutral-300">{statusMsg}</span>
        </GlassCard>
      )}

      {/* Step trace */}
      {steps.length > 0 && (
        <GlassCard className="p-6">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
            <Wand2 size={14} className="text-brand-400" /> Execution
          </div>
          <div className="space-y-1">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <motion.div
                    initial={false}
                    animate={{ scale: s.state === "active" ? 1.05 : 1 }}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                      s.state === "done"
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        : s.state === "active"
                        ? "border-brand-500/40 bg-brand-500/15 text-brand-300"
                        : "border-white/5 bg-white/[0.02] text-neutral-600"
                    )}
                  >
                    {s.state === "active" ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : s.state === "done" ? (
                      <Check size={16} />
                    ) : (
                      STEP_ICON[s.key] ?? <Sparkles size={16} />
                    )}
                  </motion.div>
                  {i < steps.length - 1 && (
                    <span className={cn("my-1 h-5 w-px", s.state === "done" ? "bg-emerald-500/30" : "bg-white/10")} />
                  )}
                </div>
                <div className="-mt-0.5 flex-1 pb-2">
                  <p className={cn("text-sm font-medium", s.state === "pending" ? "text-neutral-500" : "text-white")}>
                    {s.label}
                  </p>
                  <AnimatePresence>
                    {s.detail && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs text-neutral-500"
                      >
                        {s.detail}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Result */}
      {error ? (
        <GlassCard className="p-4">
          <ErrorState title="Agent run failed" message={error} onRetry={() => run(command)} />
        </GlassCard>
      ) : result ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {result.needs_gmail ? (
            <GlassCard className="p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Mail size={16} className="text-amber-400" /> Gmail access needed
              </div>
              <p className="mt-2 text-sm text-neutral-400">
                Re-link Gmail with read + modify access so the agent can read and act on your inbox.
              </p>
              {onLinkGmail && (
                <Button onClick={onLinkGmail} className="mt-4">
                  <RefreshCw size={15} /> Re-link Gmail
                </Button>
              )}
            </GlassCard>
          ) : draft ? (
            <GlassCard glow className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/5 p-4 text-sm font-semibold text-white">
                <PenLine size={16} className="text-brand-400" /> Draft ready — review before sending
              </div>
              <div className="space-y-3 p-5">
                {draft.to && (
                  <p className="text-xs text-neutral-500">To: <span className="text-neutral-300">{draft.to}</span></p>
                )}
                {draft.subject && <p className="text-sm font-semibold text-white">{draft.subject}</p>}
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
                  {draft.body}
                </p>
              </div>
              <div className="flex items-center gap-2 border-t border-white/5 p-4">
                <Button
                  variant="glass"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(draft.body);
                      toast.success("Draft copied");
                    } catch {
                      toast.error("Couldn't copy");
                    }
                  }}
                >
                  <Copy size={15} /> Copy
                </Button>
                <Button className="ml-auto" onClick={() => onSendDraft(draft.subject, draft.body)}>
                  <Send size={15} /> Review &amp; Send
                </Button>
              </div>
            </GlassCard>
          ) : result.summary ? (
            <GlassCard className="p-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles size={16} className="text-brand-400" /> Inbox summary
              </div>
              <p className="text-sm leading-relaxed text-neutral-200">{result.summary}</p>
            </GlassCard>
          ) : result.intent === "archive_promotions" ? (
            <GlassCard className="flex items-center gap-3 p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                <Archive size={20} />
              </div>
              <div>
                <p className="font-semibold text-white">
                  Archived {result.stats?.archived ?? 0} promotional email{(result.stats?.archived ?? 0) === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-neutral-500">Your inbox is a little cleaner.</p>
              </div>
            </GlassCard>
          ) : result.answer ? (
            <GlassCard className="p-6">
              <Markdown>{result.answer}</Markdown>
            </GlassCard>
          ) : (
            <GlassCard className="flex items-center gap-3 p-6">
              <Check size={20} className="text-emerald-400" />
              <p className="text-sm text-neutral-200">{result.message || "Done."}</p>
            </GlassCard>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
