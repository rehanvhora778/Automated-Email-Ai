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

// ---- AI Inbox Briefing ----

/** Cards are listed one by one; the rest is rolled up into groups. */
export type EmailCategory =
  | "Requires Action"
  | "Requires Reply"
  | "Important"
  | "Needs Review"
  | "Promotional"
  | "Newsletter"
  | "Low Priority";

export type Urgency = "critical" | "high" | "medium" | "low";

/**
 * One analysed email. Sender, subject and date are re-attached from Gmail
 * after the model answers, so they are always the real values; everything
 * else is the model's judgement and may be empty when it had no basis for one.
 */
export interface BriefedEmail {
  id: string;
  thread_id: string;
  ref: string;
  category: EmailCategory;
  sender: string;
  sender_email: string;
  subject: string;
  date: string;
  date_ms: number;
  unread: boolean;
  summary: string;
  why_it_matters: string;
  required_action: string;
  urgency: Urgency;
  needs_reply: boolean;
  /** Only set when the model could quote the words that state it. */
  deadline: string;
  tags: string[];
  /** Only set for "Needs Review": what was missing. */
  review_reason: string;
}

/** Promotional / newsletter / low-priority mail, rolled up. */
export interface BriefedGroup {
  label: string;
  category: EmailCategory;
  count: number;
  senders: string[];
  subjects: string[];
  note: string;
}

/** A bounce, parsed from the delivery status notification's own headers. */
export interface DeliveryFailure {
  message_id: string;
  date: string;
  date_ms: number;
  reported_by: string;
  failed_recipient: string;
  original_subject: string;
  /** SMTP enhanced status code, e.g. "5.1.1". Empty if the notice omitted it. */
  status: string;
  permanent: boolean | null;
  reason: string;
  what_to_do: string;
  diagnostic: string;
  notice_subject: string;
}

export type ActionType = "reply" | "action" | "review" | "read" | "cleanup" | "fix_delivery";

export interface RecommendedAction {
  priority: number;
  action: string;
  /** Why it is worth doing now — never empty; unexplained actions are dropped. */
  reason: string;
  urgency: Urgency;
  type: ActionType;
  refs: string[];
  email_ids: string[];
}

export interface BriefingCounts {
  analyzed: number;
  needs_reply: number;
  action_required: number;
  important: number;
  needs_review: number;
  high_priority: number;
  promotional: number;
  newsletters: number;
  low_priority: number;
  grouped: number;
  delivery_failures: number;
}

/** How much of the mailbox this briefing actually covers. */
export interface BriefingScope {
  analyzed: number;
  unread_analyzed: number;
  unread_total: number;
  read_included: number;
  /** True when there is more unread mail than this pass looked at. */
  capped: boolean;
  bodies_read: number;
}

export interface InboxBriefing {
  overview: string;
  emails: BriefedEmail[];
  groups: BriefedGroup[];
  delivery_failures: DeliveryFailure[];
  recommended_actions: RecommendedAction[];
  counts: BriefingCounts;
  scope: BriefingScope;
  /** True when the AI pass failed and only Gmail's own signals were used. */
  degraded: boolean;
}

export interface InboxStats {
  unread: number;
  analyzed: number;
  high_priority: number;
  needs_reply: number;
  action_required: number;
  delivery_failures: number;
  grouped: number;
}

export interface InboxSummaryResponse extends Partial<InboxBriefing> {
  gmail_linked: boolean;
  needs_reauth?: boolean;
  error?: string;
  user_name: string;
  stats?: InboxStats;
  /** Plain-text alias of `overview`. */
  summary?: string;
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
