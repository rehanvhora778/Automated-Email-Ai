import { toast } from "sonner";
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  supabaseConfigError,
} from "../supabaseClient";
import { SIGN_IN_SCOPES } from "./authScopes";

/** Cached answer from /auth/v1/settings — the provider list rarely changes. */
let googleEnabled: boolean | null = null;

/**
 * What the probe below managed to find out.
 *
 * "unreachable" is kept apart from "disabled" because the two need opposite
 * things from the user: one is a switch in the Supabase dashboard, the other
 * means the project itself is gone, paused or unconfigured and no amount of
 * retrying the button will help.
 */
type ProviderProbe = "enabled" | "disabled" | "unreachable";

/**
 * Ask Supabase whether the Google provider is switched on.
 *
 * This exists because `signInWithOAuth` cannot report the failure. It does not
 * validate anything client-side: it builds the authorize URL and navigates the
 * browser to it. If the provider is disabled, Supabase answers that navigation
 * with a raw JSON 400 — `{"msg":"Unsupported provider: provider is not
 * enabled"}` — which the browser renders as a page. By then the app is gone, so
 * no catch block can turn it into a friendly message.
 *
 * Checking first costs one small request and lets us fail on our own screen.
 * An ordinary unhappy response still counts as "enabled", so a hiccup at the
 * auth service does not block a sign-in that would have worked.
 */
async function probeGoogleProvider(): Promise<ProviderProbe> {
  // With no project URL the fetch below would resolve against this app's own
  // origin, come back as the index page and read as a healthy auth service.
  if (supabaseConfigError) return "unreachable";
  if (googleEnabled !== null) return googleEnabled ? "enabled" : "disabled";

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
    });
  } catch {
    // fetch only rejects when the request never completed at all — the host
    // does not resolve, the project is gone, or there is no network. Sign-in
    // cannot work either, so this must not fall through to the benefit of the
    // doubt and send the browser off to a dead address.
    return "unreachable";
  }

  if (!res.ok) return "enabled";
  try {
    const settings = await res.json();
    googleEnabled = Boolean(settings?.external?.google);
  } catch {
    return "enabled";
  }
  return googleEnabled ? "enabled" : "disabled";
}

/** Just the host, because the full URL in a toast is noise. */
function supabaseHost(): string {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
}

/**
 * Start Google OAuth through Supabase.
 *
 * Shared by the sign-in and sign-up screens: Google has no notion of "signing
 * up" versus "signing in", so both buttons do the same thing and Supabase
 * creates the user on first arrival.
 *
 * Only identity scopes are requested here. Asking for Gmail at the same time
 * made sign-in itself fail for every account that was not on the Google test-
 * user list, because those scopes are restricted; mailbox access is now a
 * separate, explicit "Link Gmail" step. See `SIGN_IN_SCOPES` for the reasoning.
 *
 * Resolves only on failure — on success the browser has already navigated away.
 */
export async function startGoogleAuth(): Promise<void> {
  const probe = await probeGoogleProvider();

  if (probe === "unreachable") {
    toast.error(
      supabaseConfigError
        ? `Sign-in isn't configured for this deployment — ${supabaseConfigError} See the browser console for what to set.`
        : `Can't reach the authentication service at ${supabaseHost()}. The Supabase project may be paused or removed, or you may be offline.`,
      { duration: 10000 }
    );
    throw new Error("supabase unreachable");
  }

  if (probe === "disabled") {
    toast.error(
      "Google sign-in isn't enabled yet. Turn it on in Supabase → Authentication → Providers → Google, then try again.",
      { duration: 8000 }
    );
    throw new Error("google provider disabled");
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
      scopes: SIGN_IN_SCOPES.join(" "),
      // `select_account` so a shared machine can switch accounts. Deliberately
      // not `consent`: with identity-only scopes there is no refresh token to
      // force, so re-prompting would just add a screen to every sign-in.
      queryParams: { prompt: "select_account" },
    },
  });

  if (error) {
    toast.error(
      /provider.*not enabled|unsupported provider/i.test(error.message)
        ? "Google sign-in isn't enabled on this Supabase project yet."
        : error.message || "Could not start Google sign-in."
    );
    throw error;
  }
}
