import { useQuery } from "@tanstack/react-query";
import {
  getInboxSummary,
  getInboxMessages,
  getEmailAnalytics,
  getGmailContacts,
  getGmailNotifications,
} from "./api";
import { supabase } from "../supabaseClient";

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

/** Real account facts read straight from Supabase (own rows via RLS). */
export interface AccountProfile {
  fullName: string | null;
  memberSince: string | null;
  lastSignInAt: string | null;
}

export function useAccountProfile(userId?: string) {
  return useQuery({
    queryKey: ["account-profile", userId],
    queryFn: async (): Promise<AccountProfile> => {
      const [profileRes, sessionRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, created_at")
          .eq("id", userId)
          .maybeSingle(),
        supabase.auth.getSession(),
      ]);
      // supabase-js resolves with {data, error} — surface failures so the UI
      // shows "—" instead of claiming a wrong value.
      if (profileRes.error) throw profileRes.error;
      const profile = profileRes.data;
      const sessionUser = sessionRes.data?.session?.user;
      return {
        fullName: profile?.full_name ?? null,
        memberSince: profile?.created_at ?? sessionUser?.created_at ?? null,
        lastSignInAt: sessionUser?.last_sign_in_at ?? null,
      };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
