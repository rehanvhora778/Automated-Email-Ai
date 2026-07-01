// Shared types for the Copilot features (Smart Reply, Inbox Summary, AI Tools).

export type ReplyStyle =
  | "professional"
  | "friendly"
  | "formal"
  | "short"
  | "negotiation"
  | "apology"
  | "ceo"
  | "sales"
  | "support"
  | "technical"
  | "detailed"
  | "persuasive"
  | "casual";

// A response may contain only the styles that were requested.
export type ReplyStyles = Partial<Record<ReplyStyle, string>>;

export interface GenerateReplyPayload {
  user_id?: string | null;
  original_email: string;
  tone?: string;
  context?: string;
  styles?: ReplyStyle[];
}

export interface ImportantEmail {
  sender: string;
  subject: string;
  insight: string;
}

export interface InboxSuggestion {
  title: string;
  type: "reply" | "follow_up" | "respond" | "thank_you" | string;
}

export interface InboxStats {
  unread: number;
  high_priority: number;
  meetings_today: number;
  pending_followups: number;
  total: number;
}

export interface InboxSummaryResponse {
  gmail_linked: boolean;
  needs_reauth?: boolean;
  error?: string;
  user_name: string;
  stats?: InboxStats;
  summary?: string;
  important?: ImportantEmail[];
  spam?: { count: number; note: string };
  newsletters?: { count: number; note: string };
  action_items?: string[];
  suggestions?: InboxSuggestion[];
}

export type ToolAction =
  | "cover_letter"
  | "cold_email"
  | "translate"
  | "improve"
  | "rewrite"
  | "custom";

export interface ToolPayload {
  user_id?: string | null;
  action: ToolAction;
  input: string;
  context?: string;
}

export interface ToolResponse {
  content: string;
  error?: string;
}

// ---- Inbox tabs + Gmail actions ----

export type InboxTab =
  | "overview"
  | "important"
  | "promotions"
  | "newsletters"
  | "finance"
  | "travel"
  | "social"
  | "updates";

export interface InboxMessage {
  id: string;
  thread_id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
}

export interface InboxMessagesResponse {
  gmail_linked: boolean;
  needs_reauth?: boolean;
  error?: string;
  messages: InboxMessage[];
}

export type InboxActionType =
  | "archive"
  | "trash"
  | "mark_important"
  | "mark_unimportant"
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar";

// ---- AI Agent Mode ----

export interface AgentDraft {
  to: string;
  subject: string;
  body: string;
}

export interface AgentStep {
  key: string;
  label: string;
  state: "pending" | "active" | "done";
  detail?: string;
}

/** A single event from the streamed /agent/run response. */
export interface AgentEvent {
  type: "status" | "plan" | "step" | "result" | "error";
  message?: string;
  intent?: string;
  steps?: { key: string; label: string }[];
  key?: string;
  state?: "active" | "done";
  detail?: string;
  summary?: string;
  answer?: string;
  draft?: AgentDraft | null;
  stats?: { archived?: number };
  needs_gmail?: boolean;
}
