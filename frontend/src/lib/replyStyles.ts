import type { ReplyStyle } from "./types";

export interface ReplyStyleMeta {
  key: ReplyStyle;
  label: string;
  color: string; // tailwind gradient classes
  desc: string;
}

/**
 * Single source of truth for Smart Reply styles — ordered for display and shared
 * by both the style-picker chips (SmartReply) and the result cards (ReplyCard).
 * Keys must match the backend REPLY_STYLE_GUIDE in ai_service.py.
 */
export const REPLY_STYLES: ReplyStyleMeta[] = [
  { key: "professional", label: "Professional", color: "from-indigo-500/50 to-blue-500/40", desc: "Polished & courteous" },
  { key: "friendly", label: "Friendly", color: "from-emerald-500/50 to-teal-500/40", desc: "Warm & personable" },
  { key: "ceo", label: "CEO Style", color: "from-fuchsia-500/50 to-pink-500/40", desc: "Decisive & brief" },
  { key: "negotiation", label: "Negotiation", color: "from-violet-500/50 to-purple-500/40", desc: "Push back politely" },
  { key: "sales", label: "Sales", color: "from-orange-500/50 to-red-500/40", desc: "Persuasive, clear CTA" },
  { key: "support", label: "Customer Support", color: "from-cyan-500/50 to-sky-500/40", desc: "Empathetic & helpful" },
  { key: "technical", label: "Technical", color: "from-blue-500/50 to-indigo-500/40", desc: "Precise & specific" },
  { key: "persuasive", label: "Persuasive", color: "from-purple-500/50 to-fuchsia-500/40", desc: "Compelling case" },
  { key: "detailed", label: "Detailed", color: "from-teal-500/50 to-emerald-500/40", desc: "Thorough & complete" },
  { key: "short", label: "Short", color: "from-amber-500/50 to-orange-500/40", desc: "1-2 sentences" },
  { key: "formal", label: "Formal", color: "from-slate-400/50 to-slate-500/40", desc: "Traditional etiquette" },
  { key: "casual", label: "Casual", color: "from-lime-500/50 to-green-500/40", desc: "Relaxed & conversational" },
  { key: "apology", label: "Apology", color: "from-rose-500/50 to-pink-500/40", desc: "Gracious & accountable" },
];

export const REPLY_STYLE_META: Record<string, ReplyStyleMeta> = Object.fromEntries(
  REPLY_STYLES.map((s) => [s.key, s])
);

/** A sensible starter selection so the first generate isn't 13 calls at once. */
export const DEFAULT_SELECTED_STYLES: ReplyStyle[] = [
  "professional", "friendly", "ceo", "negotiation", "sales", "short",
];
