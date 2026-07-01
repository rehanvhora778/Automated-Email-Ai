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
