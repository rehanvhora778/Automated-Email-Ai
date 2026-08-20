import { useEffect, useState } from "react";

/**
 * Tracks whether a password reset is mid-flight, and how it was started.
 *
 * Verifying a recovery code signs the user in — that is how Supabase grants the
 * permission to call `updateUser({ password })` at all. But App swaps the auth
 * screen for the dashboard the instant a session appears, which would unmount
 * the reset form before the new password had been typed, leaving the account on
 * its old password with no sign anything went wrong.
 *
 * So the flow raises `active` before verifying and lowers it once the password
 * is saved, and App keeps showing the auth screen while it is raised. A module
 * level store rather than component state because the two live on opposite
 * sides of that render gate.
 *
 * `fromLink` covers the other way in. Supabase's reset email can carry a code
 * or a link, depending on whether the project's template includes `{{ .Token }}`
 * — and the stock template sends only a link. Clicking it returns to the app
 * with a recovery session already established, which supabase-js reports as a
 * PASSWORD_RECOVERY event. Without handling that, a link-based email drops the
 * user on the dashboard still holding their old password. When this flag is set
 * the reset screen opens straight at "choose a new password", the email and
 * code steps having effectively already happened.
 */
type RecoveryState = { active: boolean; fromLink: boolean };

let state: RecoveryState = { active: false, fromLink: false };
const listeners = new Set<(value: RecoveryState) => void>();

function publish(next: RecoveryState) {
  if (state.active === next.active && state.fromLink === next.fromLink) return;
  state = next;
  listeners.forEach((notify) => notify(state));
}

/** Raise or lower the gate for the in-app code flow. */
export function setRecovering(value: boolean) {
  publish(value ? { active: true, fromLink: state.fromLink } : { active: false, fromLink: false });
}

/** A recovery link was followed — open the reset screen at the password step. */
export function beginLinkRecovery() {
  publish({ active: true, fromLink: true });
}

/** Re-renders the caller whenever the reset flow starts or finishes. */
export function useRecoveryState(): RecoveryState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state); // catch a change that landed between render and effect
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

/** Convenience for the render gate, which only cares that a reset is running. */
export function useIsRecovering(): boolean {
  return useRecoveryState().active;
}
