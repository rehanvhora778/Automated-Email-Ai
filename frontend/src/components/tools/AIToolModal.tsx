import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Send, Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { streamTool } from "../../lib/api";
import type { ToolAction } from "../../lib/types";
import { Button } from "../ui/Button";
import { Markdown } from "../ui/Markdown";
import { ErrorState } from "../ui/ErrorState";

const meta: Record<ToolAction, { title: string; placeholder: string; contextLabel?: string; contextPlaceholder?: string }> = {
  cover_letter: { title: "Cover Letter", placeholder: "Paste the job description or describe the role you're applying for…", contextLabel: "Company / role", contextPlaceholder: "e.g. Frontend Engineer at Acme" },
  cold_email: { title: "Cold Email", placeholder: "Who are you reaching out to, and what's the ask?", contextLabel: "Recipient / goal", contextPlaceholder: "e.g. Hiring manager, request a referral" },
  translate: { title: "Translate Email", placeholder: "Paste the text you want translated…", contextLabel: "Target language", contextPlaceholder: "e.g. Spanish" },
  improve: { title: "Improve Writing", placeholder: "Paste the text you want to improve…" },
  rewrite: { title: "Rewrite Email", placeholder: "Paste the text you want to rewrite…", contextLabel: "Desired tone", contextPlaceholder: "e.g. more concise and confident" },
  custom: { title: "AI Assistant", placeholder: "What do you need help writing?" },
};

export function AIToolModal({
  open,
  action,
  userId,
  onClose,
  onSendDraft,
}: {
  open: boolean;
  action: ToolAction | null;
  userId?: string;
  onClose: () => void;
  onSendDraft: (subject: string, body: string) => void;
}) {
  const [input, setInput] = useState("");
  const [context, setContext] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const m = action ? meta[action] : meta.custom;

  // Reset (and cancel any in-flight stream) whenever the modal opens for an action.
  useEffect(() => {
    if (open) {
      abortRef.current?.abort();
      setInput("");
      setContext("");
      setOutput("");
      setCopied(false);
      setStreaming(false);
      setErrorMsg(null);
    }
  }, [open, action]);

  // Cancel the stream if the modal is closed while generating.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  // Keep the newest streamed text in view.
  useEffect(() => {
    if (streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [output, streaming]);

  const generate = async () => {
    if (!input.trim() || !action) return;
    setErrorMsg(null);
    setOutput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTool(
        { user_id: userId, action, input, context },
        (chunk) => setOutput((prev) => prev + chunk),
        controller.signal
      );
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErrorMsg(e?.message || "Generation failed");
        toast.error(e?.message || "Generation failed");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <AnimatePresence>
      {open && action && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900 shadow-card"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                  <Wand2 size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-white">{m.title}</h2>
                  <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                    {streaming ? (
                      <>
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Streaming…
                      </>
                    ) : (
                      "Powered by AI · streamed live"
                    )}
                  </p>
                </div>
              </div>
              <button onClick={handleClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-neutral-500 hover:bg-white/5 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto p-5">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={5}
                placeholder={m.placeholder}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
              />
              {m.contextLabel && (
                <input
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder={m.contextPlaceholder || m.contextLabel}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
                />
              )}

              {streaming ? (
                <Button variant="danger" onClick={stop} className="w-full">
                  <span className="h-3 w-3 rounded-[3px] bg-current" /> Stop generating
                </Button>
              ) : (
                <Button onClick={generate} disabled={!input.trim()} className="w-full">
                  <Wand2 size={16} /> Generate {m.title}
                </Button>
              )}

              {/* Output */}
              {errorMsg ? (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
                  <ErrorState title="Generation failed" message={errorMsg} onRetry={generate} />
                </div>
              ) : streaming && !output ? (
                <div className="flex items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-sm text-neutral-400">
                  <Loader2 size={16} className="animate-spin" /> Thinking…
                </div>
              ) : output ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  {streaming ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
                      {output}
                      <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] animate-pulse bg-brand-400 align-middle" />
                    </p>
                  ) : (
                    <Markdown>{output}</Markdown>
                  )}
                </div>
              ) : null}
            </div>

            {/* Footer actions (only once there's finished output) */}
            {output && !streaming && !errorMsg && (
              <div className="flex items-center gap-2 border-t border-white/5 p-4">
                <Button variant="glass" onClick={copy}>
                  {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  className="ml-auto"
                  onClick={() => {
                    onSendDraft(m.title, output);
                    handleClose();
                  }}
                >
                  <Send size={15} /> Use in email
                </Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
