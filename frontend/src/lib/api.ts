import axios from "axios";
import { supabase } from "../supabaseClient";
import type {
  GenerateReplyPayload,
  ReplyStyles,
  InboxSummaryResponse,
  InboxMessagesResponse,
  InboxActionType,
  AnalyticsResponse,
  ContactsResponse,
  NotificationsResponse,
  ToolPayload,
  MlVerdict,
  ClassifyHealthResponse,
} from "./types";

/**
 * Backend base URL.
 *
 * Set VITE_API_URL in the deployment environment (Vercel -> Settings ->
 * Environment Variables) to the Render service URL. The localhost fallback
 * keeps a fresh clone working with no .env file.
 *
 * Trailing slashes are trimmed because axios would otherwise build "//api/v1".
 *
 * A production bundle pointing at localhost is always a build-time mistake:
 * VITE_ values are frozen into the bundle, so nothing can correct it at
 * runtime and every call fails against a machine that isn't there. Say so in
 * the console rather than letting it look like a network fault.
 */
const RAW_API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const API_URL = RAW_API_URL.replace(/\/+$/, "");

if (import.meta.env.PROD && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(API_URL)) {
  console.error(
    `[config] This build targets ${API_URL}, which will not exist for your users. ` +
      "Set VITE_API_URL to the backend's public URL in your hosting environment " +
      "and redeploy — rebuilding is required, since the value is inlined at build time."
  );
}

export const apiClient = axios.create({ baseURL: API_URL });

/**
 * The Supabase access token for the current session, or null when signed out.
 *
 * `getSession()` reads from local storage and refreshes the token when it has
 * expired, so this is also what keeps a long-open tab's requests authorised.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Attach the session to every backend call.
 *
 * The backend used to identify the caller by a `user_id` sent in the query
 * string, which meant anyone holding a user's UUID — and those are not secret,
 * they end up in browser history, logs and Referer headers — could read that
 * person's mailbox or send mail as them. Identity now comes from this token
 * and nothing else; the `userId` arguments below are kept only because callers
 * use them as React Query cache keys.
 */
apiClient.interceptors.request.use(async (config) => {
  const header = await authHeader();
  if (header.Authorization) config.headers.set("Authorization", header.Authorization);
  return config;
});

// ---- Reading a failed request ------------------------------------------
//
// FastAPI puts its message in `detail`, and axios nests the response body
// under `error.response.data` with the status alongside it. A request that
// never reached the server has no `response` at all, so every reader below
// narrows from `unknown` and copes with the shape being absent. Callers used
// to reach through `any` for this, which silently permitted any path at all.

interface ApiErrorEnvelope {
  response?: { status?: number; data?: { detail?: unknown } };
}

function envelope(error: unknown): ApiErrorEnvelope {
  return (typeof error === "object" && error !== null ? error : {}) as ApiErrorEnvelope;
}

/** HTTP status of a failed request, or undefined if it never got a response. */
export function apiErrorStatus(error: unknown): number | undefined {
  const status = envelope(error).response?.status;
  return typeof status === "number" ? status : undefined;
}

/** The server's own message, when it sent one. */
export function apiErrorDetail(error: unknown): string | undefined {
  const detail = envelope(error).response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : undefined;
}

/** The server's message, else something the user can actually read. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  return apiErrorDetail(error) ?? fallback;
}

/**
 * Message of a thrown Error, else the fallback. For the streaming paths, which
 * use `fetch` and fold the server's detail into the Error they throw, so there
 * is no axios envelope to read.
 */
export function thrownMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** True when the caller aborted the request rather than it failing. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Smart Reply — six reply styles from a pasted email. */
export async function generateReplies(
  payload: GenerateReplyPayload
): Promise<ReplyStyles> {
  const { data } = await apiClient.post("/api/v1/reply/generate", payload);
  return data.replies as ReplyStyles;
}

/** AI Inbox Summary — reads recent Gmail and returns a structured briefing. */
export async function getInboxSummary(
  userId: string
): Promise<InboxSummaryResponse> {
  const { data } = await apiClient.get("/api/v1/inbox/summary");
  return data as InboxSummaryResponse;
}

/** List inbox messages for a tab (primary/important/promotions/…) with flags. */
export async function getInboxMessages(
  userId: string,
  tab: string
): Promise<InboxMessagesResponse> {
  const { data } = await apiClient.get("/api/v1/inbox/messages", {
    params: { tab },
  });
  return data as InboxMessagesResponse;
}

/** Real Gmail analytics — volume, daily trend, category mix, top senders. */
export async function getEmailAnalytics(
  userId: string
): Promise<AnalyticsResponse> {
  const { data } = await apiClient.get("/api/v1/analytics/overview");
  return data as AnalyticsResponse;
}

/** Real contacts derived from Gmail senders/recipients. */
export async function getGmailContacts(
  userId: string
): Promise<ContactsResponse> {
  const { data } = await apiClient.get("/api/v1/contacts/list");
  return data as ContactsResponse;
}

/** Real notifications — your latest unread Gmail messages. */
export async function getGmailNotifications(
  userId: string
): Promise<NotificationsResponse> {
  const { data } = await apiClient.get("/api/v1/notifications/list");
  return data as NotificationsResponse;
}

/** Mark the given messages read (really removes Gmail's UNREAD label). */
export async function markNotificationsRead(
  userId: string,
  messageIds: string[]
): Promise<void> {
  await apiClient.post("/api/v1/notifications/read_all", {
    message_ids: messageIds,
  });
}

/** Perform a single Gmail action (archive/trash/label/star/read) on a message. */
export async function runInboxAction(
  userId: string,
  messageId: string,
  action: InboxActionType
): Promise<void> {
  await apiClient.post("/api/v1/inbox/action", {
    message_id: messageId,
    action,
  });
}

/**
 * Score an email with a locally trained classifier — no LLM, no token cost.
 *
 * Returns null instead of throwing when the model has not been trained yet
 * (503) or the text is too short to score honestly (400), so callers can treat
 * the ML verdict as a progressive enhancement over the LLM explanation.
 */
export async function classifyEmail(
  kind: "spam" | "phishing",
  text: string,
  signal?: AbortSignal
): Promise<MlVerdict | null> {
  try {
    const { data } = await apiClient.post(
      `/api/v1/ai/classify/${kind}`,
      { text },
      { signal }
    );
    return data as MlVerdict;
  } catch {
    return null;
  }
}

/**
 * Status and stored evaluation metrics for both trained classifiers.
 *
 * Returns null rather than throwing when the backend is unreachable, so the
 * AI Tools page can render its cards without the metric badges instead of
 * failing outright.
 */
export async function classifyHealth(): Promise<ClassifyHealthResponse | null> {
  try {
    const { data } = await apiClient.get("/api/v1/ai/classify/health");
    return data as ClassifyHealthResponse;
  } catch {
    return null;
  }
}

/**
 * Run an AI writing tool, streaming the result. Calls `onChunk` with each text
 * delta as it arrives and resolves with the full text. Pass an AbortSignal to
 * cancel. The backend also exposes a non-streaming POST /api/v1/ai/tool, which
 * nothing in this app calls.
 */
export async function streamTool(
  payload: ToolPayload,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/ai/tool/stream`, {
    method: "POST",
    // fetch bypasses the axios interceptor, so the session has to be attached
    // by hand here or the backend answers 401.
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok || !res.body) {
    // FastAPI serialises an error as {"detail": "..."}, so the raw body text
    // is a JSON envelope. Showing it unparsed put `{"detail":"…"}` in front of
    // the user; pull the message out and fall back to the text only if it is
    // not the shape we expect.
    const body = await res.text().catch(() => "");
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") {
        detail = parsed.detail;
      } else if (Array.isArray(parsed?.detail)) {
        // A 422 from FastAPI's own validation is a list of error objects, not
        // a sentence — which is what an over-length paste produces now that
        // the AI fields are bounded. Read the first one rather than putting
        // a JSON array in front of the user.
        const first = parsed.detail[0];
        detail =
          res.status === 422
            ? "That text is too long to process. Try a shorter excerpt."
            : (typeof first?.msg === "string" && first.msg) || body;
      }
    } catch {
      /* not JSON — use the text as-is */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      full += text;
      onChunk(text);
    }
  }
  // flush any trailing bytes
  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onChunk(tail);
  }
  return full;
}

// ---- Account + Gmail linking -------------------------------------------

/** Who the backend thinks you are, and whether your mailbox is connected. */
export interface AccountStatus {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  gmail_linked: boolean;
  /** The Google address that was linked, when the backend could read it. */
  gmail_email: string | null;
  /** Which mailbox permissions the stored grant actually carries. */
  gmail_scopes: { send: boolean; read: boolean; modify: boolean };
}

/**
 * The signed-in user's account state, from the backend rather than the browser.
 *
 * Gmail status used to be read straight out of `profiles.gmail_token` with the
 * anon key, which meant a long-lived Google refresh token was shipped to the
 * tab on every page load purely to decide whether to show a button. The token
 * now stays server-side and this returns only the booleans the UI needs.
 */
export async function getAccountStatus(): Promise<AccountStatus> {
  const { data } = await apiClient.get("/api/v1/auth/me");
  return data as AccountStatus;
}

/** Step 1 of linking: ask the backend for a consent URL and its state nonce. */
export async function beginGmailLink(): Promise<{ url: string; state: string }> {
  const { data } = await apiClient.get("/api/v1/actions/login-google");
  return data as { url: string; state: string };
}

/**
 * Step 3 of linking: prove this is the browser that started the flow.
 *
 * Google hands its authorization code to the backend, which exchanges it and
 * parks the result against the state nonce — it does not attach it to anyone
 * yet. This call is what attaches it, and it only succeeds when the caller's
 * session matches the account the attempt was minted for. Without that step a
 * link could be aimed at someone else's account.
 */
export async function completeGmailLink(
  state: string
): Promise<{ linked: boolean; email: string | null; scope: string; reason?: string }> {
  const { data } = await apiClient.post("/api/v1/actions/complete-link", { state });
  return data as { linked: boolean; email: string | null; scope: string; reason?: string };
}

/**
 * Disconnect the mailbox, at Google as well as here.
 *
 * Clearing the stored row on its own left the grant live on Google's side: the
 * app kept appearing under the user's third-party access list, and any copy of
 * the token that had leaked still opened the mailbox. `revoked` reports whether
 * Google accepted the revocation.
 */
export async function unlinkGmail(): Promise<{ unlinked: boolean; revoked: boolean }> {
  const { data } = await apiClient.post("/api/v1/actions/unlink-google");
  return data as { unlinked: boolean; revoked: boolean };
}

/** Send mail through the user's linked Gmail account, with an optional attachment. */
export async function sendGmailMessage(input: {
  to: string;
  subject: string;
  body: string;
  file?: File | null;
}): Promise<void> {
  const form = new FormData();
  form.append("to_email", input.to);
  form.append("subject", input.subject);
  form.append("body", input.body);
  if (input.file) form.append("file", input.file);
  await apiClient.post("/api/v1/actions/send-email", form);
}
