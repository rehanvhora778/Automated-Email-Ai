import { useQuery } from "@tanstack/react-query";
import { getInboxSummary } from "./api";

/** Shared inbox-summary query — Dashboard and the Inbox widget reuse one cached fetch. */
export function useInboxSummary(userId?: string) {
  return useQuery({
    queryKey: ["inbox-summary", userId],
    queryFn: () => getInboxSummary(userId as string),
    enabled: !!userId,
  });
}
