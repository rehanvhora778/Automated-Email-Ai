import { toast } from "sonner";
import { supabase, supabaseUrl, supabaseAnonKey } from "../supabaseClient";
import { GMAIL_SCOPES } from "./authScopes";

/** Cached answer from /auth/v1/settings — the provider list rarely changes. */
let googleEnabled: boolean | null = null;

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
 * Returns true when the check itself fails, so a network blip does not block a
 * sign-in that would otherwise have worked.
 */
async function isGoogleEnabled(): Promise<boolean> {
  if (googleEnabled !== null) return googleEnabled;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
    });
    if (!res.ok) return true;
    const settings = await res.json();
    googleEnabled = Boolean(settings?.external?.google);
    return googleEnabled;
  } catch {
    return true;
  }
}

/**
 * Start Google OAuth through Supabase.
 *
 * Shared by the sign-in and sign-up screens: Google has no notion of "signing
 * up" versus "signing in", so both buttons do the same thing and Supabase
 * creates the user on first arrival.
 *
 * `access_type: 'offline'` plus `prompt: 'consent'` is what makes Google return
 * a refresh token. Without both, Gmail access would die the moment the first
 * access token expired.
 *
 * Resolves only on failure — on success the browser has already navigated away.
 */
export async function startGoogleAuth(): Promise<void> {
  if (!(await isGoogleEnabled())) {
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
      scopes: GMAIL_SCOPES.join(" "),
      queryParams: { access_type: "offline", prompt: "consent" },
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
