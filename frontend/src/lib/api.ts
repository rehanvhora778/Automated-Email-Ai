import axios from "axios";
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
  const { data } = await apiClient.get("/api/v1/inbox/summary", {
    params: { user_id: userId },
  });
  return data as InboxSummaryResponse;
}

/** List inbox messages for a tab (primary/important/promotions/…) with flags. */
export async function getInboxMessages(
  userId: string,
  tab: string
): Promise<InboxMessagesResponse> {
  const { data } = await apiClient.get("/api/v1/inbox/messages", {
    params: { user_id: userId, tab },
  });
  return data as InboxMessagesResponse;
}

/** Real Gmail analytics — volume, daily trend, category mix, top senders. */
export async function getEmailAnalytics(
  userId: string
): Promise<AnalyticsResponse> {
  const { data } = await apiClient.get("/api/v1/analytics/overview", {
    params: { user_id: userId },
  });
  return data as AnalyticsResponse;
}

/** Real contacts derived from Gmail senders/recipients. */
export async function getGmailContacts(
  userId: string
): Promise<ContactsResponse> {
  const { data } = await apiClient.get("/api/v1/contacts/list", {
    params: { user_id: userId },
  });
  return data as ContactsResponse;
}

/** Real notifications — your latest unread Gmail messages. */
export async function getGmailNotifications(
  userId: string
): Promise<NotificationsResponse> {
  const { data } = await apiClient.get("/api/v1/notifications/list", {
    params: { user_id: userId },
  });
  return data as NotificationsResponse;
}

/** Mark the given messages read (really removes Gmail's UNREAD label). */
export async function markNotificationsRead(
  userId: string,
  messageIds: string[]
): Promise<void> {
  await apiClient.post("/api/v1/notifications/read_all", {
    user_id: userId,
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
    user_id: userId,
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
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
