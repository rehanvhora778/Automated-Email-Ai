import axios from "axios";
import { apiClient } from "./api";

/**
 * First-party email verification codes.
 *
 * Signup and password reset used to lean on Supabase's mailer, which sends a
 * confirmation *link* unless the project's email template is edited to include
 * `{{ .Token }}`, and whose code length is a project setting the app cannot
 * see. Both are dashboard state, so the six-box screens could not be relied on.
 * These endpoints issue and check the code themselves over the backend's own
 * SMTP. Supabase still owns the accounts.
 */
export type OtpPurpose = "signup" | "recovery";

/** Turn an axios failure into the backend's message, or a readable fallback. */
export function otpErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (!error.response) return "Could not reach the server. Check your connection and try again.";
  }
  return fallback;
}

export async function requestOtp(email: string, purpose: OtpPurpose): Promise<void> {
  await apiClient.post("/api/v1/otp/request", { email, purpose });
}

/** Verify the code and create the account. Does not sign in — the caller does. */
export async function verifySignupCode(params: {
  email: string;
  code: string;
  password: string;
  full_name?: string;
}): Promise<void> {
  await apiClient.post("/api/v1/otp/verify-signup", params);
}

/** Verify the code and set a new password. Does not sign in — the caller does. */
export async function verifyRecoveryCode(params: {
  email: string;
  code: string;
  password: string;
}): Promise<void> {
  await apiClient.post("/api/v1/otp/verify-recovery", params);
}
