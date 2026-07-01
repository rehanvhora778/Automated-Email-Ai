/**
 * Representative "preview" data for the new analytics-style surfaces
 * (Analytics, Calendar, Contacts, Notifications, dashboard insight cards).
 *
 * These values are DETERMINISTIC and clearly flagged in the UI with a
 * "Preview" badge. They exist so the premium surfaces look alive before the
 * real Gmail-analytics / calendar endpoints are wired up. When those backend
 * routes land, swap the individual getters here for React Query hooks — the
 * component contracts (TrendPoint, BarPoint, DonutSegment, etc.) already match.
 */
import type { TrendPoint } from "../components/charts/AreaTrend";
import type { BarPoint } from "../components/charts/MiniBars";
import type { DonutSegment } from "../components/charts/DonutChart";

export const IS_PREVIEW_DATA = true;

export const weeklyTrend: TrendPoint[] = [
  { label: "Mon", a: 24, b: 18 },
  { label: "Tue", a: 32, b: 27 },
  { label: "Wed", a: 28, b: 22 },
  { label: "Thu", a: 41, b: 30 },
  { label: "Fri", a: 37, b: 33 },
  { label: "Sat", a: 12, b: 9 },
  { label: "Sun", a: 8, b: 6 },
];

export const monthlyTrend: BarPoint[] = [
  { label: "W1", value: 142 },
  { label: "W2", value: 168 },
  { label: "W3", value: 131 },
  { label: "W4", value: 197 },
];

export const inboxGrowth: TrendPoint[] = [
  { label: "Jan", a: 320 },
  { label: "Feb", a: 410 },
  { label: "Mar", a: 388 },
  { label: "Apr", a: 502 },
  { label: "May", a: 560 },
  { label: "Jun", a: 640 },
];

export const categorySegments: DonutSegment[] = [
  { name: "Important", value: 34, color: "#6366f1" },
  { name: "Work", value: 28, color: "#22d3ee" },
  { name: "Newsletters", value: 18, color: "#f59e0b" },
  { name: "Promotions", value: 14, color: "#f43f5e" },
  { name: "Social", value: 6, color: "#10b981" },
];

/** 18 weeks × 7 days of 0-4 intensity levels — deterministic pseudo-random. */
export const activityWeeks: number[][] = Array.from({ length: 18 }, (_, w) =>
  Array.from({ length: 7 }, (_, d) => {
    const seed = (w * 7 + d) * 2654435761;
    const v = ((seed >>> 8) % 100) / 100;
    const weekend = d >= 5 ? 0.4 : 1;
    return Math.min(4, Math.floor(v * 5 * weekend));
  })
);

export interface ReplySpeed {
  average: string;
  fastest: string;
  slowest: string;
  responseRate: number;
  openRate: number;
}

export const replySpeed: ReplySpeed = {
  average: "2h 14m",
  fastest: "3m",
  slowest: "1d 6h",
  responseRate: 87,
  openRate: 64,
};

export interface DemoContact {
  name: string;
  email: string;
  company: string;
  conversations: number;
  lastContact: string;
  summary: string;
}

export const contacts: DemoContact[] = [
  { name: "Aman Verma", email: "aman@acme.io", company: "Acme Inc.", conversations: 42, lastContact: "2h ago", summary: "Primary client contact on the Q3 rollout; usually replies within the hour and prefers concise updates." },
  { name: "Sarah Chen", email: "sarah.chen@northwind.co", company: "Northwind", conversations: 28, lastContact: "Yesterday", summary: "Design partner discussing the onboarding revamp. Awaiting your feedback on the latest mockups." },
  { name: "Michael Ross", email: "m.ross@brightlabs.dev", company: "Bright Labs", conversations: 17, lastContact: "3d ago", summary: "Technical lead coordinating the API integration. Open thread about rate limits." },
  { name: "Priya Nair", email: "priya@finhub.in", company: "FinHub", conversations: 11, lastContact: "1w ago", summary: "Finance stakeholder; follow up on the pending invoice and renewal terms." },
  { name: "David Kim", email: "david@lumen.app", company: "Lumen", conversations: 9, lastContact: "2w ago", summary: "Intro from a mutual connection; exploring a partnership. Cold thread going warm." },
  { name: "Elena García", email: "elena@velocity.es", company: "Velocity", conversations: 6, lastContact: "3w ago", summary: "Recruiter reaching out about a senior role. Politely deferred, keep warm." },
];

export interface DemoMeeting {
  title: string;
  time: string;
  day: "today" | "tomorrow" | "week";
  attendees: string[];
  accent: string;
}

export const meetings: DemoMeeting[] = [
  { title: "Product sync", time: "10:00 AM", day: "today", attendees: ["Aman Verma", "Sarah Chen"], accent: "from-indigo-500 to-blue-500" },
  { title: "1:1 with Michael", time: "1:30 PM", day: "today", attendees: ["Michael Ross"], accent: "from-violet-500 to-purple-500" },
  { title: "Design review", time: "4:00 PM", day: "today", attendees: ["Sarah Chen", "David Kim"], accent: "from-emerald-500 to-teal-500" },
  { title: "Client onboarding — Acme", time: "9:30 AM", day: "tomorrow", attendees: ["Aman Verma"], accent: "from-amber-500 to-orange-500" },
  { title: "Sprint planning", time: "11:00 AM", day: "tomorrow", attendees: ["Michael Ross", "Priya Nair"], accent: "from-sky-500 to-cyan-500" },
  { title: "Quarterly business review", time: "Thu · 2:00 PM", day: "week", attendees: ["Priya Nair", "Elena García"], accent: "from-rose-500 to-pink-500" },
];

export interface DemoNotification {
  id: string;
  kind: "ai" | "sent" | "meeting" | "mention" | "system";
  title: string;
  detail: string;
  time: string;
  unread: boolean;
}

export const notifications: DemoNotification[] = [
  { id: "n1", kind: "ai", title: "AI finished drafting", detail: "Your cold email to David Kim is ready to review.", time: "2m ago", unread: true },
  { id: "n2", kind: "sent", title: "Email sent", detail: "Reply to Aman Verma delivered successfully.", time: "18m ago", unread: true },
  { id: "n3", kind: "meeting", title: "Meeting in 30 minutes", detail: "Product sync with Aman & Sarah at 10:00 AM.", time: "30m", unread: true },
  { id: "n4", kind: "mention", title: "You were mentioned", detail: "Sarah Chen mentioned you in “Onboarding revamp”.", time: "1h ago", unread: false },
  { id: "n5", kind: "ai", title: "3 emails need follow-up", detail: "AI flagged threads waiting on your reply for 2+ days.", time: "3h ago", unread: false },
  { id: "n6", kind: "system", title: "Gmail sync complete", detail: "Analyzed 640 emails across 5 categories.", time: "5h ago", unread: false },
];

export interface DemoAiAction {
  action: string;
  detail: string;
  time: string;
  kind: "reply" | "summarize" | "compose" | "translate" | "schedule";
}

export const recentAiActions: DemoAiAction[] = [
  { action: "Generated 6 replies", detail: "For Aman Verma's quotation request", time: "12m ago", kind: "reply" },
  { action: "Summarized inbox", detail: "15 emails · 3 need attention", time: "1h ago", kind: "summarize" },
  { action: "Drafted cold email", detail: "Outreach to Bright Labs", time: "2h ago", kind: "compose" },
  { action: "Translated email", detail: "Spanish → English for Velocity", time: "4h ago", kind: "translate" },
  { action: "Scheduled follow-up", detail: "Reminder set for FinHub invoice", time: "Yesterday", kind: "schedule" },
];

export const smartRecommendations: { title: string; detail: string; accent: string }[] = [
  { title: "Reply to 3 waiting threads", detail: "You have replies pending for 2+ days.", accent: "from-indigo-500 to-blue-500" },
  { title: "Archive 14 promotions", detail: "Clear low-priority mail in one click.", accent: "from-amber-500 to-orange-500" },
  { title: "Follow up with David Kim", detail: "No response in 5 days — nudge the thread.", accent: "from-emerald-500 to-teal-500" },
];
