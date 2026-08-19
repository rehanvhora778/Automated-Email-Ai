import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

/**
 * Six-box one-time-code input.
 *
 * Behaviours people expect from an OTP field, none of which come for free:
 *  - typing advances to the next box, backspace on an empty box steps back
 *  - pasting the whole code from an email fills every box at once
 *  - arrow keys move between boxes
 *  - only digits are accepted, and the code auto-submits when complete
 *
 * `inputMode="numeric"` + `autoComplete="one-time-code"` let mobile browsers
 * offer the code straight from the SMS/email notification.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  length = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const setAt = (index: number, digit: string) => {
    const chars = value.padEnd(length, " ").split("");
    chars[index] = digit || " ";
    const next = chars.join("").replace(/\s/g, " ").trimEnd();
    onChange(next.replace(/\s/g, ""));
    return next.replace(/\s/g, "");
  };

  const handleInput = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;

    // Rebuild the string positionally so editing a middle box works.
    const chars = value.split("");
    while (chars.length < index) chars.push("");
    chars[index] = digit;
    const next = chars.join("").slice(0, length);
    onChange(next);

    if (index < length - 1) refs.current[index + 1]?.focus();
    if (next.length === length) onComplete?.(next);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const chars = value.split("");
      if (chars[index]) {
        chars[index] = "";
        onChange(chars.join("").replace(/\s+$/, ""));
      } else if (index > 0) {
        chars[index - 1] = "";
        onChange(chars.join("").replace(/\s+$/, ""));
        refs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
    if (pasted.length === length) onComplete?.(pasted);
  };

  return (
    <div className="flex justify-between gap-2" onPaste={handlePaste as never}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={value[i] ?? ""}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${i + 1} of ${length}`}
          className="h-14 w-full rounded-2xl border border-white/10 bg-white/5 text-center text-xl font-bold text-white outline-none transition-colors focus:border-brand-400 focus:bg-white/[0.07] disabled:opacity-50"
        />
      ))}
    </div>
  );
}
