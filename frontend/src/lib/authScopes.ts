/**
 * Google OAuth scopes, split by what they cost the user.
 *
 * Signing in and reading mail are two very different asks, and Google treats
 * them that way. Identity scopes are non-sensitive: any Google account can
 * approve them on a published app, with no verification and no warning screen.
 * The Gmail scopes are *restricted* — until the app passes Google's review,
 * only accounts listed as test users may grant them, and everyone else is
 * turned away with `access_denied`.
 *
 * Bundling both into the sign-in request therefore locked the whole app to the
 * test-user list: a visitor could not even get to the front door. So sign-in
 * now asks for identity only, and Gmail access is requested separately, at the
 * point the user actually clicks "Link Gmail" — see `handleGoogleLogin` in
 * App.tsx, which hands off to the backend's /actions/login-google flow.
 */

/** Requested at sign-in. Non-sensitive, so every Google account can consent. */
export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const;

/**
 * Requested by the "Link Gmail" flow, not at sign-in.
 *
 * Must stay in step with `SCOPES` in `backend/app/api/v1/actions.py`, which is
 * what actually drives that flow — this list is the frontend's record of what
 * mailbox access the app assumes once a user has linked.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

/**
 * Whether a sign-in consent also grants mailbox access.
 *
 * Derived rather than hard-coded so that putting the Gmail scopes back into
 * SIGN_IN_SCOPES (once the app is verified) re-enables the token capture in
 * App.tsx on its own, instead of silently leaving it switched off.
 */
export const SIGN_IN_GRANTS_GMAIL = (SIGN_IN_SCOPES as readonly string[]).some((s) =>
  s.includes('gmail.')
);
