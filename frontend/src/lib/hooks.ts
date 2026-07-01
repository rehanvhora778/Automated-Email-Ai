import { useQuery } from "@tanstack/react-query";
import { getInboxSummary, getInboxMessages } from "./api";

/** Shared inbox-summary query — Dashboard and the Inbox widget reuse one cached fetch. */
export function useInboxSummary(userId?: string) {
  return useQuery({
    queryKey: ["inbox-summary", userId],
    queryFn: () => getInboxSummary(userId as string),
    enabled: !!userId,
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
