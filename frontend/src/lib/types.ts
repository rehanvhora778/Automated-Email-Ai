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
  | "translate"
  | "improve"
  | "rewrite"
  | "custom"
  | "grammar_fix"
  | "summarize"
  | "tone_detection"
  | "spam_detection"
  | "phishing_detection";

export interface ToolPayload {
  action: ToolAction;
  input: string;
  context?: string;
}

export interface ToolResponse {
  content: string;
  error?: string;
  /** Present only for actions backed by a locally trained model. */
  ml?: MlVerdict;
}

// ---- Local ML classifiers (trained models, not LLM prompts) ----

/**
 * A verdict from a locally trained scikit-learn model. These run in about a
 * millisecond with no network call, so the UI can show a result immediately
 * while the LLM explanation is still streaming in behind it.
 *
 * See ml/README.md for how the models were trained and evaluated.
 */
export interface MlVerdict {
  available: boolean;
  /** Spam model: "Spam" | "Suspicious" | "Not spam".
   *  Phishing model: "Phishing" | "Suspicious" | "Safe". */
  verdict: string;
  is_spam?: boolean;
  is_phishing?: boolean;
  /** Confidence in the predicted class, 0-100. */
  confidence: number;
  spam_probability?: number;
  phishing_probability?: number;
  /** Terms in this email that drove the score, strongest first. */
  signals: string[];
  latency_ms: number;
  model: string;
}

/** Evaluation metrics recorded when a model was trained. */
export interface MlModelHealth {
  available: boolean;
  model_path: string;
  selected?: string;
  test_metrics?: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    roc_auc: number;
  };
  dataset?: Record<string, string | number>;
}

/** GET /api/v1/ai/classify/health — status of both trained classifiers. */
export interface ClassifyHealthResponse {
  spam: MlModelHealth;
  phishing: MlModelHealth;
}

// ---- Inbox tabs + Gmail actions ----

export type InboxTab =
  | "overview"
  | "primary"
  | "important"
  | "starred"
  | "unread"
  | "social"
  | "promotions"
  | "updates"
  | "forums"
  | "newsletters";

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

// ---- Email Analytics (real Gmail data) ----

export interface AnalyticsDay {
  label: string;
  sent: number;
  received: number;
}

export interface AnalyticsCategory {
  name: string;
  count: number;
  color: string;
}

export interface AnalyticsSender {
  name: string;
  email: string;
  count: number;
}

export interface AnalyticsResponse {
  gmail_linked: boolean;
  needs_reauth?: boolean;
  error?: string;
  email_address?: string;
  totals?: { messages: number; threads: number; inbox: number; unread: number };
  sent_30d?: number;
  sent_30d_capped?: boolean;
  received_30d?: number;
  received_30d_capped?: boolean;
  daily?: AnalyticsDay[];
  categories?: AnalyticsCategory[];
  top_senders?: AnalyticsSender[];
}

// ---- Contacts (derived from Gmail senders/recipients) ----

export interface GmailContact {
  name: string;
  email: string;
  domain: string;
  received: number;
  sent: number;
  count: number;
  last_ms: number;
}

export interface ContactsResponse {
  gmail_linked: boolean;
  needs_reauth?: boolean;
  error?: string;
  contacts: GmailContact[];
}

// ---- Notifications (unread Gmail messages) ----

export interface GmailNotification {
  id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  snippet: string;
  time_ms: number;
  category: "primary" | "social" | "promotions" | "updates" | "forums" | string;
  important: boolean;
  starred: boolean;
}

export interface NotificationsResponse {
  gmail_linked: boolean;
  needs_reauth?: boolean;
  error?: string;
  notifications: GmailNotification[];
}

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
