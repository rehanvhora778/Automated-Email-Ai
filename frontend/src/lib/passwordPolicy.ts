/**
 * Password rules, mirrored from `backend/app/services/password_policy.py`.
 *
 * The backend is what actually enforces these — it is the only side an attacker
 * cannot skip. This copy exists so the requirements can be shown live as
 * someone types, rather than as a rejection after they submit. Keep the two in
 * step; the wording is deliberately identical so a server error never
 * contradicts the checklist on screen.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

export interface PasswordRule {
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (v) => v.length >= MIN_PASSWORD_LENGTH },
  { label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "A number", test: (v) => /[0-9]/.test(v) },
  { label: "A special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordIsValid(value: string): boolean {
  return value.length <= MAX_PASSWORD_LENGTH && PASSWORD_RULES.every((r) => r.test(value));
}

/** How many rules pass — drives the strength bar. */
export function passwordScore(value: string): number {
  return PASSWORD_RULES.filter((r) => r.test(value)).length;
}
