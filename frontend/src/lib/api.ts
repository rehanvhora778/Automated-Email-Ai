import axios from "axios";
import type {
  GenerateReplyPayload,
  ReplyStyles,
  InboxSummaryResponse,
  ToolPayload,
  ToolResponse,
} from "./types";

// Keep in sync with the base URL used by the existing App.jsx.
export const API_URL = "http://localhost:8000";

export const apiClient = axios.create({ baseURL: API_URL });

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

/** Generic AI writing tool (cover letter, cold email, translate, improve, rewrite). */
export async function runTool(payload: ToolPayload): Promise<ToolResponse> {
  const { data } = await apiClient.post("/api/v1/ai/tool", payload);
  return data as ToolResponse;
}

/**
 * Streaming variant of runTool. Calls `onChunk` with each text delta as it
 * arrives and resolves with the full text. Pass an AbortSignal to cancel.
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
