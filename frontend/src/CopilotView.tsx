import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Inbox as InboxIcon } from "lucide-react";
import type { ToolAction } from "./lib/types";
import { Dashboard } from "./pages/Dashboard";
import { SmartReply } from "./components/reply/SmartReply";
import { InboxSummary } from "./components/dashboard/InboxSummary";
import { AIToolModal } from "./components/tools/AIToolModal";
import { Analytics } from "./pages/Analytics";
import { CalendarView } from "./pages/CalendarView";
import { Contacts } from "./pages/Contacts";
import { Notifications } from "./pages/Notifications";
import { Settings } from "./pages/Settings";
import { Profile } from "./pages/Profile";
import { PageTransition } from "./components/ui/PageTransition";

export type CopilotViewName =
  | "dashboard"
  | "smartReply"
  | "inbox"
  | "analytics"
  | "calendar"
  | "contacts"
  | "notifications"
  | "settings"
  | "profile";

export interface CopilotUser {
  id: string;
  email?: string;
}

/**
 * Renders the new Copilot experiences (Dashboard, Smart Reply, Inbox Summary,
 * plus the Analytics/Calendar/Contacts/Notifications/Settings/Profile pages)
 * and hosts the shared AI-tool modal. The existing chat workspace stays in App.jsx.
 */
export function CopilotView({
  view,
  user,
  onNavigate,
  onCompose,
  onSendDraft,
  onLinkGmail,
  onLogout,
  openToolAction,
  onToolHandled,
}: {
  view: CopilotViewName;
  user: CopilotUser;
  onNavigate: (view: string) => void;
  onCompose: () => void;
  onSendDraft: (subject: string, body: string) => void;
  onLinkGmail: () => void;
  onLogout?: () => void;
  openToolAction?: ToolAction | null;
  onToolHandled?: () => void;
}) {
  const [toolAction, setToolAction] = useState<ToolAction | null>(null);
  const [toolOpen, setToolOpen] = useState(false);

  const openTool = (action: ToolAction) => {
    setToolAction(action);
    setToolOpen(true);
  };

  // Allow the command palette / FAB (owned by App) to open a tool remotely.
  useEffect(() => {
    if (openToolAction) {
      openTool(openToolAction);
      onToolHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openToolAction]);

  const fallbackName = user.email?.split("@")[0] || "there";

  return (
    <div className="h-full overflow-y-auto bg-radial-glow px-5 py-8 sm:px-8 lg:px-10">
      <AnimatePresence mode="wait">
        <PageTransition key={view} id={view}>
          {view === "dashboard" && (
            <Dashboard
              userId={user.id}
              fallbackName={fallbackName}
              onNavigate={onNavigate}
              onCompose={onCompose}
              onOpenTool={openTool}
              onLinkGmail={onLinkGmail}
            />
          )}

          {view === "smartReply" && <SmartReply userId={user.id} onSendDraft={onSendDraft} />}

          {view === "inbox" && (
            <div className="mx-auto max-w-3xl space-y-6">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
                  <InboxIcon size={22} className="text-brand-400" /> Inbox Summary
                </h1>
                <p className="mt-1 text-sm text-neutral-500">An AI briefing of your most recent emails.</p>
              </div>
              <InboxSummary userId={user.id} onLinkGmail={onLinkGmail} />
            </div>
          )}

          {view === "analytics" && <Analytics userId={user.id} />}
          {view === "calendar" && <CalendarView />}
          {view === "contacts" && <Contacts onCompose={onCompose} />}
          {view === "notifications" && <Notifications />}
          {view === "settings" && <Settings userEmail={user.email} onLinkGmail={onLinkGmail} />}
          {view === "profile" && (
            <Profile userEmail={user.email} userId={user.id} onLinkGmail={onLinkGmail} />
          )}
        </PageTransition>
      </AnimatePresence>

      <AIToolModal
        open={toolOpen}
        action={toolAction}
        userId={user.id}
        onClose={() => setToolOpen(false)}
        onSendDraft={onSendDraft}
      />
    </div>
  );
}
