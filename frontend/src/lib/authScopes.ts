/**
 * Google OAuth scopes requested at sign-in.
 *
 * These must stay in step with `SCOPES` in `backend/app/api/v1/actions.py` —
 * that module's "Link Gmail" flow is the fallback path, and if the two lists
 * drift a user could sign in with narrower access than the app assumes it has.
 *
 * Requesting the Gmail scopes during sign-in is deliberate: it means one
 * consent screen grants both identity and mailbox access, instead of making the
 * user approve Google twice.
 */
export const GMAIL_SCOPES = [
  // identity — what Supabase needs to create the session
  'openid',
  'email',
  'profile',
  // mailbox — what the assistant needs to do its job
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
] as const;
