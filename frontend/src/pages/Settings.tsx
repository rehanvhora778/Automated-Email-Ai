import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Settings as SettingsIcon, Mail, KeyRound, ShieldCheck, LogOut,
  RefreshCw, Unlink, Eye, EyeOff, Check, AlertTriangle, User,
} from "lucide-react";
import { GlassCard } from "../components/ui/GlassCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { supabase } from "../supabaseClient";
import { apiErrorMessage, unlinkGmail } from "../lib/api";
import { useAccountStatus } from "../lib/hooks";
import { PasswordChecklist } from "../components/auth/PasswordChecklist";
import { passwordIsValid } from "../lib/passwordPolicy";

function Row({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-neutral-300">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">{title}</p>
        {desc && <p className="text-xs text-neutral-500">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function SectionTitle({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="mb-1">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white">{icon} {title}</h2>
      <p className="text-xs text-neutral-500">{desc}</p>
    </div>
  );
}

export function Settings({
  userId,
  userEmail,
  provider,
  onLinkGmail,
  onLogout,
}: {
  userId: string;
  userEmail?: string;
  /** Supabase auth provider — "google" accounts have no password to change. */
  provider?: string;
  onLinkGmail?: () => void;
  onLogout?: () => void;
}) {
  // Google accounts authenticate through Google; there is no local password,
  // so the reset panel would be a dead end for them.
  const isPasswordAccount = (provider ?? "email") !== "google";
  const queryClient = useQueryClient();

  // --- Real Gmail link status (the backend answers; the token stays there) ---
  const gmailStatus = useAccountStatus(userId);

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const handleUnlink = async () => {
    if (!confirmUnlink) {
      setConfirmUnlink(true);
      setTimeout(() => setConfirmUnlink(false), 5000);
      return;
    }
    setUnlinking(true);
    try {
      // Forgetting the token here would leave the grant alive at Google: the
      // app would stay listed under the user's third-party access and any
      // copy of the token that got out would still open the mailbox. The
      // backend revokes it with Google first, then clears the row.
      const { revoked } = await unlinkGmail();
      // Every surface in the app reads Gmail, so drop all cached data.
      queryClient.invalidateQueries();
      toast.success(
        revoked
          ? "Gmail unlinked and access revoked at Google. Link it again anytime."
          : "Gmail unlinked here, but Google did not confirm the revocation — remove this app under your Google account's third-party access to be certain."
      );
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not unlink Gmail. Try again in a moment."));
    } finally {
      setUnlinking(false);
      setConfirmUnlink(false);
    }
  };

  // --- Password reset (email/password accounts only) ---
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleResetPassword = async () => {
    if (!passwordIsValid(newPassword)) {
      toast.error("Your password does not meet all the requirements listed.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setSavingPassword(true);

    // Supabase has no "is this my current password" call, so ask the only way
    // there is: try to sign in with it. Succeeding means nothing would change,
    // and reporting a successful update would be untrue.
    if (userEmail) {
      const { error: sameError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: newPassword,
      });
      if (!sameError) {
        setSavingPassword(false);
        toast.error("That is already your current password. Choose a different one.");
        return;
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error(
        /should be different|same as/i.test(error.message)
          ? "That is already your current password. Choose a different one."
          : error.message
      );
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated. Use the new password next time you sign in.");
  };

  // Mapped rather than used raw so the markup below keeps naming the three
  // capabilities the way the user sees them on screen.
  const status = gmailStatus.data;
  const s = status && {
    linked: status.gmail_linked,
    send: status.gmail_scopes.send,
    read: status.gmail_scopes.read,
    actions: status.gmail_scopes.modify,
  };
  const missingScopes = s?.linked && (!s.read || !s.actions || !s.send);

  const inputClass =
    "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white/25";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <SettingsIcon size={24} className="text-brand-400" /> Settings
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Your account, Gmail connection and security — all live, no placeholders.</p>
      </motion.div>

      {/* ---------- Account ---------- */}
      <section className="space-y-3">
        <SectionTitle icon={<User size={17} className="text-brand-400" />} title="Account" desc="The account you signed in with." />
        <GlassCard className="space-y-3 p-5">
          <Row
            icon={<Mail size={18} />}
            title={userEmail ?? "Unknown"}
            desc={isPasswordAccount ? "Signed in with email and password." : "Signed in with Google."}
            action={<Badge tone="success"><Check size={11} /> Signed in</Badge>}
          />
          <Row
            icon={<LogOut size={18} className="text-rose-400" />}
            title="Sign out"
            desc="Log out of this device."
            action={<Button variant="danger" onClick={onLogout}><LogOut size={15} /> Sign out</Button>}
          />
        </GlassCard>
      </section>

      {/* ---------- Gmail connection ---------- */}
      <section className="space-y-3">
        <SectionTitle icon={<Mail size={17} className="text-rose-400" />} title="Gmail connection" desc="Powers sending, inbox summaries, analytics and inbox actions." />
        <GlassCard className="space-y-3 p-5">
          <Row
            icon={<Mail size={18} className="text-rose-400" />}
            title="Gmail"
            desc={
              gmailStatus.isLoading ? "Checking connection…"
                : !s?.linked ? "Not linked yet — connect to unlock every feature."
                : missingScopes ? "Linked, but missing permissions — re-link to grant full access."
                : "Linked with full access (send, read, actions)."
            }
            action={
              <div className="flex items-center gap-2">
                {gmailStatus.isLoading ? (
                  <Badge tone="neutral">Checking…</Badge>
                ) : s?.linked ? (
                  missingScopes
                    ? <Badge tone="warning"><AlertTriangle size={11} /> Partial</Badge>
                    : <Badge tone="success"><Check size={11} /> Connected</Badge>
                ) : (
                  <Badge tone="danger">Not linked</Badge>
                )}
                <button
                  onClick={() => gmailStatus.refetch()}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-neutral-400 transition-colors hover:text-white"
                  title="Refresh status"
                >
                  <RefreshCw size={14} className={gmailStatus.isFetching ? "animate-spin" : undefined} />
                </button>
              </div>
            }
          />

          {s?.linked && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Send email", ok: s.send },
                { label: "Read inbox", ok: s.read },
                { label: "Inbox actions", ok: s.actions },
              ].map((cap) => (
                <div key={cap.label} className="flex items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                  {cap.ok
                    ? <Check size={14} className="shrink-0 text-emerald-400" />
                    : <AlertTriangle size={14} className="shrink-0 text-amber-400" />}
                  <span className="truncate text-xs font-medium text-neutral-300">{cap.label}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={onLinkGmail}>
              <Mail size={15} /> {s?.linked ? "Re-link Gmail" : "Link Gmail"}
            </Button>
            {s?.linked && (
              <Button variant="danger" onClick={handleUnlink} disabled={unlinking}>
                <Unlink size={15} /> {unlinking ? "Unlinking…" : confirmUnlink ? "Click again to confirm" : "Unlink"}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-neutral-600">
            Linking sends you to Google for consent and brings you straight back here once it's done.
          </p>
        </GlassCard>
      </section>

      {/* ---------- Reset password (email/password accounts only) ---------- */}
      {isPasswordAccount && (
        <section className="space-y-3">
          <SectionTitle icon={<ShieldCheck size={17} className="text-emerald-400" />} title="Reset password" desc={`Changes the sign-in password for ${userEmail ?? "your account"}.`} />
          <GlassCard className="space-y-4 p-5">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                autoComplete="new-password"
              />
              <button
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <PasswordChecklist value={newPassword} />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
              className={inputClass}
              autoComplete="new-password"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-neutral-600">
                Takes effect immediately — you stay signed in on this device.
              </p>
              <Button
                variant="primary"
                onClick={handleResetPassword}
                disabled={savingPassword || !newPassword || !confirmPassword}
              >
                <KeyRound size={15} /> {savingPassword ? "Updating…" : "Update password"}
              </Button>
            </div>
          </GlassCard>
        </section>
      )}
    </div>
  );
}
