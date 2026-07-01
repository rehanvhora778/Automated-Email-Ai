/** Deterministic, on-device metrics + format helpers for a reply draft. */

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

/** Estimated reading time at ~200 wpm. */
export function readingTime(text: string): string {
  const seconds = Math.max(1, Math.round((wordCount(text) / 200) * 60));
  if (seconds < 60) return `${seconds}s read`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s read` : `${m}m read`;
}

/** Estimated time to type the reply by hand at ~40 wpm. */
export function writingTime(text: string): string {
  const seconds = Math.max(1, Math.round((wordCount(text) / 40) * 60));
  if (seconds < 60) return `~${seconds}s to write`;
  return `~${Math.round(seconds / 60)}m to write`;
}

/**
 * Heuristic "AI confidence" (50-98%) estimated from reply completeness: a healthy
 * length band, a sign-off, no bracket placeholders and a clean ending. Fully
 * deterministic — the same text always yields the same score.
 */
export function confidenceScore(text: string): number {
  const words = wordCount(text);
  let score = 58;
  if (words >= 15) score += 10;
  if (words >= 35 && words <= 240) score += 12;
  if (/\b(regards|sincerely|thanks|thank you|best|cheers|warm)\b/i.test(text)) score += 8;
  if (!/\[[^\]]+\]/.test(text)) score += 6; // no [placeholders]
  if (/[.?!]["')]?\s*$/.test(text.trim())) score += 4;
  return Math.max(50, Math.min(98, score));
}

/** Convert a plain-text reply into simple, email-safe HTML. */
export function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Normalise a plain-text reply into Markdown (paragraphs preserved). */
export function toMarkdown(text: string): string {
  return text.trim().replace(/\n{3,}/g, "\n\n");
}
