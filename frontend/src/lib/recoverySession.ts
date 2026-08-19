import { useEffect, useState } from "react";

/**
 * Tracks whether a password reset is mid-flight.
 *
 * Verifying a recovery code signs the user in — that is how Supabase grants the
 * permission to call `updateUser({ password })` at all. But App swaps the auth
 * screen for the dashboard the instant a session appears, which would unmount
 * the reset form before the new password had been typed, leaving the account on
 * its old password with no sign anything went wrong.
 *
 * So the flow raises this flag before verifying and lowers it once the password
 * is saved, and App keeps showing the auth screen while it is raised. A module
 * level store rather than component state because the two live on opposite
 * sides of that render gate.
 */
let recovering = false;
const listeners = new Set<(value: boolean) => void>();

export function setRecovering(value: boolean) {
  if (recovering === value) return;
  recovering = value;
  listeners.forEach((notify) => notify(value));
}

/** Re-renders the caller whenever the reset flow starts or finishes. */
export function useIsRecovering(): boolean {
  const [value, setValue] = useState(recovering);
  useEffect(() => {
    listeners.add(setValue);
    setValue(recovering); // catch a change that landed between render and effect
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
