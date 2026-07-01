import { useEffect, useState } from "react";
import { Copy, Check, Pencil, Send, RefreshCw, Code2, Hash, Clock, PenLine, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { Badge } from "../ui/Badge";
import { cn } from "../../lib/cn";
import { REPLY_STYLE_META } from "../../lib/replyStyles";
import { readingTime, writingTime, confidenceScore, toHtml, toMarkdown } from "../../lib/replyUtils";

const actionBtn =
  "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none";

type Copied = null | "text" | "html" | "md";

export function ReplyCard({
  styleKey,
  body,
  loading = false,
  delay = 0,
  onSend,
  onRegenerate,
}: {
  styleKey: string;
  body: string;
  loading?: boolean;
  delay?: number;
  onSend: (body: string) => void;
  onRegenerate: () => void;
}) {
  const meta = REPLY_STYLE_META[styleKey] ?? { label: styleKey, color: "from-indigo-500/50 to-blue-500/40" };
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState<Copied>(null);

  useEffect(() => setText(body), [body]);

  const conf = confidenceScore(text);
  const confTone = conf >= 85 ? "success" : conf >= 70 ? "info" : "warning";

  const flash = (k: Copied) => {
    setCopied(k);
    setTimeout(() => setCopied(null), 1500);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash("text");
      toast.success(`${meta.label} reply copied`);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const copyHtml = async () => {
    const html = toHtml(text);
    try {
      if ("ClipboardItem" in window && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      flash("html");
      toast.success("Copied as HTML");
    } catch {
      toast.error("Couldn't copy HTML");
    }
  };

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(text));
      flash("md");
      toast.success("Copied as Markdown");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <GlassCard delay={delay} className="flex h-full flex-col p-5">
      {/* Header: style + confidence */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={cn("rounded-full bg-gradient-to-r px-3 py-1 text-xs font-bold text-white", meta.color)}>
          {meta.label}
        </span>
        {!loading && (
          <Badge tone={confTone}>
            <Sparkles size={11} /> {conf}% confident
          </Badge>
        )}
        {loading && <RefreshCw size={14} className="animate-spin text-neutral-500" />}
      </div>

      {/* Metrics */}
      {!loading && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1"><Clock size={11} /> {readingTime(text)}</span>
          <span className="text-neutral-700">·</span>
          <span className="flex items-center gap-1"><PenLine size={11} /> {writingTime(text)}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 py-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          className="min-h-[160px] w-full flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 p-3 text-sm leading-relaxed text-neutral-100 outline-none focus:border-white/25"
        />
      ) : (
        <p className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">{text}</p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-4">
        <button onClick={copyText} disabled={loading} className={cn(actionBtn, "text-neutral-300 hover:bg-white/5 hover:text-white")}>
          {copied === "text" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied === "text" ? "Copied" : "Copy"}
        </button>
        <button onClick={copyHtml} disabled={loading} title="Copy as rich HTML" className={cn(actionBtn, "text-neutral-300 hover:bg-white/5 hover:text-white")}>
          {copied === "html" ? <Check size={14} className="text-emerald-400" /> : <Code2 size={14} />}
          HTML
        </button>
        <button onClick={copyMd} disabled={loading} title="Copy as Markdown" className={cn(actionBtn, "text-neutral-300 hover:bg-white/5 hover:text-white")}>
          {copied === "md" ? <Check size={14} className="text-emerald-400" /> : <Hash size={14} />}
          MD
        </button>
        <button onClick={() => setEditing((e) => !e)} disabled={loading} className={cn(actionBtn, "text-neutral-300 hover:bg-white/5 hover:text-white")}>
          <Pencil size={14} /> {editing ? "Done" : "Edit"}
        </button>
        <button onClick={onRegenerate} disabled={loading} className={cn(actionBtn, "text-neutral-300 hover:bg-white/5 hover:text-white")}>
          <RefreshCw size={14} />
        </button>
        <button onClick={() => onSend(text)} disabled={loading} className={cn(actionBtn, "ml-auto bg-white text-black hover:bg-neutral-200")}>
          <Send size={14} /> Send
        </button>
      </div>
    </GlassCard>
  );
}
