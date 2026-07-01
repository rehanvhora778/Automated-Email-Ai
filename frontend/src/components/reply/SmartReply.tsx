import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sparkles, Wand2, Reply as ReplyIcon, LayoutGrid, Columns } from "lucide-react";
import { toast } from "sonner";
import { generateReplies } from "../../lib/api";
import type { ReplyStyle, ReplyStyles } from "../../lib/types";
import { REPLY_STYLES, DEFAULT_SELECTED_STYLES } from "../../lib/replyStyles";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { cn } from "../../lib/cn";
import { ReplyCard } from "./ReplyCard";

const TONES = ["Balanced", "Warm", "Assertive", "Concise", "Enthusiastic", "Diplomatic"];

interface FormValues {
  original_email: string;
  tone: string;
  context: string;
}

export function SmartReply({
  userId,
  onSendDraft,
}: {
  userId?: string;
  onSendDraft: (subject: string, body: string) => void;
}) {
  const { register, handleSubmit, watch, setValue, formState: { errors } } =
    useForm<FormValues>({ defaultValues: { original_email: "", tone: "", context: "" } });

  const tone = watch("tone");
  const [selected, setSelected] = useState<ReplyStyle[]>(DEFAULT_SELECTED_STYLES);
  const [replies, setReplies] = useState<ReplyStyles | null>(null);
  const [lastInput, setLastInput] = useState<FormValues | null>(null);
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [compare, setCompare] = useState(false);

  const genMut = useMutation({
    mutationFn: (vals: FormValues) =>
      generateReplies({ user_id: userId, original_email: vals.original_email, tone: vals.tone, context: vals.context, styles: selected }),
    onSuccess: (data) => {
      setReplies(data);
      toast.success(`${Object.keys(data).length} replies generated`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Generation failed"),
  });

  const onSubmit = (vals: FormValues) => {
    if (!selected.length) return toast.error("Pick at least one reply style");
    setLastInput(vals);
    genMut.mutate(vals);
  };

  const toggleStyle = (k: ReplyStyle) =>
    setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const regenerate = async (style: ReplyStyle) => {
    if (!lastInput) return;
    setRegenerating((r) => ({ ...r, [style]: true }));
    try {
      const data = await generateReplies({ user_id: userId, ...lastInput, styles: [style] });
      setReplies((prev) => ({ ...(prev ?? {}), [style]: data[style] ?? "" }));
      toast.success(`Regenerated ${style} reply`);
    } catch {
      toast.error("Regenerate failed");
    } finally {
      setRegenerating((r) => ({ ...r, [style]: false }));
    }
  };

  const loading = genMut.isPending;
  // Render in canonical order, showing only the styles that came back.
  const presentStyles = REPLY_STYLES.filter((s) => replies && replies[s.key] != null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <ReplyIcon size={22} className="text-brand-400" /> Smart Reply
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Paste an email you received, pick your styles, and get ready-to-send replies with confidence scores.
        </p>
      </div>

      {/* Input form */}
      <GlassCard className="p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Original email
            </label>
            <textarea
              {...register("original_email", { required: true, minLength: 3 })}
              rows={6}
              placeholder={"Hi Rehan,\n\nCan you send me the quotation by tomorrow?\n\nRegards,\nAman"}
              className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-white/25"
            />
            {errors.original_email && (
              <p className="mt-1 text-xs text-red-400">Please paste the email you want to reply to.</p>
            )}
          </div>

          {/* Style picker */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Reply styles ({selected.length})
              </label>
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => setSelected(REPLY_STYLES.map((s) => s.key))} className="text-neutral-400 hover:text-white">
                  Select all
                </button>
                <span className="text-neutral-700">·</span>
                <button type="button" onClick={() => setSelected(DEFAULT_SELECTED_STYLES)} className="text-neutral-400 hover:text-white">
                  Reset
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {REPLY_STYLES.map((s) => {
                const on = selected.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleStyle(s.key)}
                    title={s.desc}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                      on
                        ? "border-brand-500/40 bg-brand-500/20 text-white"
                        : "border-white/10 text-neutral-400 hover:border-white/20 hover:text-white"
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Tone (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setValue("tone", tone === t ? "" : t)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                    tone === t
                      ? "border-brand-500/40 bg-brand-500/20 text-white"
                      : "border-white/10 text-neutral-400 hover:border-white/20 hover:text-white"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Context (optional)
            </label>
            <input
              {...register("context")}
              placeholder="e.g. I can only deliver by Friday"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-white/25"
            />
          </div>

          <Button type="submit" disabled={loading || !selected.length} className="w-full sm:w-auto">
            <Wand2 size={16} /> {loading ? "Generating…" : `Generate ${selected.length} replies`}
          </Button>
        </form>
      </GlassCard>

      {/* View toggle */}
      {(replies || loading) && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-500">
            {loading ? "Generating replies…" : `${presentStyles.length} replies · each editable & ready to send`}
          </p>
          <div className="flex rounded-xl border border-white/10 bg-white/[0.02] p-1 text-xs font-semibold">
            <button
              onClick={() => setCompare(false)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors", !compare ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white")}
            >
              <LayoutGrid size={14} /> Grid
            </button>
            <button
              onClick={() => setCompare(true)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors", compare ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white")}
            >
              <Columns size={14} /> Compare
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {selected.map((s, i) => (
            <ReplyCard key={s} styleKey={s} body="" loading delay={i * 0.05} onSend={() => {}} onRegenerate={() => {}} />
          ))}
        </div>
      ) : genMut.isError ? (
        <GlassCard className="p-6">
          <ErrorState
            title="Couldn't generate replies"
            message={(genMut.error as any)?.response?.data?.detail}
            onRetry={() => lastInput && genMut.mutate(lastInput)}
          />
        </GlassCard>
      ) : replies ? (
        compare ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
            {presentStyles.map((s, i) => (
              <div key={s.key} className="w-[340px] shrink-0">
                <ReplyCard
                  styleKey={s.key}
                  body={replies[s.key] ?? ""}
                  loading={regenerating[s.key]}
                  delay={i * 0.04}
                  onSend={(bodyText) => onSendDraft("", bodyText)}
                  onRegenerate={() => regenerate(s.key)}
                />
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid items-start gap-4 lg:grid-cols-2">
            {presentStyles.map((s, i) => (
              <ReplyCard
                key={s.key}
                styleKey={s.key}
                body={replies[s.key] ?? ""}
                loading={regenerating[s.key]}
                delay={i * 0.05}
                onSend={(bodyText) => onSendDraft("", bodyText)}
                onRegenerate={() => regenerate(s.key)}
              />
            ))}
          </motion.div>
        )
      ) : (
        <GlassCard className="p-2">
          <EmptyState
            icon={<Sparkles size={26} />}
            title="Your replies will appear here"
            description="Paste an email above, choose your styles (Professional, CEO, Sales, Technical and more), and hit Generate. Each reply shows an AI confidence score and is editable and ready to send."
          />
        </GlassCard>
      )}
    </div>
  );
}
