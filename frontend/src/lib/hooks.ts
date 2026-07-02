import { useQuery } from "@tanstack/react-query";
import {
  getInboxSummary,
  getInboxMessages,
  getEmailAnalytics,
  getGmailContacts,
  getGmailNotifications,
} from "./api";

/** Shared inbox-summary query — Dashboard and the Inbox widget reuse one cached fetch. */
export function useInboxSummary(userId?: string) {
  return useQuery({
    queryKey: ["inbox-summary", userId],
    queryFn: () => getInboxSummary(userId as string),
    enabled: !!userId,
  });
}

/** Gmail analytics — a heavier endpoint, so results are cached for 5 minutes. */
export function useEmailAnalytics(userId?: string) {
  return useQuery({
    queryKey: ["email-analytics", userId],
    queryFn: () => getEmailAnalytics(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Contacts derived from recent Gmail traffic — cached for 5 minutes. */
export function useGmailContacts(userId?: string) {
  return useQuery({
    queryKey: ["gmail-contacts", userId],
    queryFn: () => getGmailContacts(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Unread Gmail messages presented as notifications — cached for 1 minute. */
export function useGmailNotifications(userId?: string) {
  return useQuery({
    queryKey: ["gmail-notifications", userId],
    queryFn: () => getGmailNotifications(userId as string),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

/** Messages for a single inbox tab. Disabled for the "overview" tab (AI summary). */
export function useInboxMessages(userId?: string, tab: string = "important") {
  return useQuery({
    queryKey: ["inbox-messages", userId, tab],
    queryFn: () => getInboxMessages(userId as string, tab),
    enabled: !!userId && tab !== "overview",
  });
}
