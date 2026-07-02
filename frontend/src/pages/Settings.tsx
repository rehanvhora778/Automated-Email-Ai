import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Settings as SettingsIcon, Mail, KeyRound, ShieldCheck, LogOut,
  RefreshCw, Unlink, Eye, EyeOff, Check, AlertTriangle, User,
} from "lucide-react";
import { GlassCard } from "../components/ui/GlassCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { supabase } from "../supabaseClient";

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

/** What the linked Google token is allowed to do, parsed from its OAuth scopes. */
function tokenCapabilities(scope?: string) {
  const s = scope ?? "";
  return {
    send: s.includes("gmail.send"),
    read: s.includes("gmail.readonly"),
    actions: s.includes("gmail.modify"),
  };
}

export function Settings({
  userId,
  userEmail,
  onLinkGmail,
  onLogout,
}: {
  userId: string;
  userEmail?: string;
  onLinkGmail?: () => void;
  onLogout?: () => void;
}) {
  const queryClient = useQueryClient();

  // --- Real Gmail link status (reads the user's own profile row via RLS) ---
  const gmailStatus = useQuery({
    queryKey: ["gmail-status", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("gmail_token")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const token = data?.gmail_token as { scope?: string } | null;
      return { linked: !!token, ...tokenCapabilities(token?.scope) };
    },
    enabled: !!userId,
    staleTime: 0,
    refetchOnWindowFocus: true, // picks up the new token when you return from the Google tab
  });

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const handleUnlink = async () => {
    if (!confirmUnlink) {
      setConfirmUnlink(true);
      setTimeout(() => setConfirmUnlink(false), 5000);
      return;
    }
    setUnlinking(true);
    const { error } = await supabase.from("profiles").update({ gmail_token: null }).eq("id", userId);
    setUnlinking(false);
    setConfirmUnlink(false);
    if (error) {
      toast.error(`Could not unlink Gmail: ${error.message}`);
      return;
    }
    // Every surface in the app reads Gmail, so drop all cached data.
    queryClient.invalidateQueries();
    toast.success("Gmail unlinked. Link it again anytime.");
  };

  // --- Real password reset for the account email (Supabase auth) ---
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated. Use the new password next time you sign in.");
  };

  const s = gmailStatus.data;
  const missingScopes = s?.linked && (!s.read || !s.actions || !s.send);

  const inputClass =
    "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white/25";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <SettingsIcon size={24} className="text-brand-400" /> Settings
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Your account, Gmail connection and password — all live, no placeholders.</p>
      </motion.div>

      {/* ---------- Account ---------- */}
      <section className="space-y-3">
        <SectionTitle icon={<User size={17} className="text-brand-400" />} title="Account" desc="The email you signed up with." />
        <GlassCard className="space-y-3 p-5">
          <Row
            icon={<Mail size={18} />}
            title={userEmail ?? "Unknown"}
            desc="Signed in with email and password."
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
        <SectionTitle icon={<Mail size={17} className="text-rose-400" />} title="Gmail connection" desc="Powers sending, inbox summaries, analytics and agent actions." />
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
            Linking opens Google in a new tab. When you're done, come back here — the status refreshes automatically.
          </p>
        </GlassCard>
      </section>

      {/* ---------- Reset password ---------- */}
      <section className="space-y-3">
        <SectionTitle icon={<ShieldCheck size={17} className="text-emerald-400" />} title="Reset password" desc={`Changes the sign-in password for ${userEmail ?? "your account"}.`} />
        <GlassCard className="space-y-4 p-5">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="New password (min. 6 characters)"
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
    </div>
  );
}
