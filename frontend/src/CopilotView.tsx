import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { ToolAction } from "./lib/types";
import { Dashboard } from "./pages/Dashboard";
import { SmartReply } from "./components/reply/SmartReply";
import { InboxCenter } from "./pages/InboxCenter";
import { AgentMode } from "./pages/AgentMode";
import { AITools } from "./pages/AITools";
import { AIToolModal } from "./components/tools/AIToolModal";
import { Analytics } from "./pages/Analytics";
import { Contacts } from "./pages/Contacts";
import { Notifications } from "./pages/Notifications";
import { Settings } from "./pages/Settings";
import { Profile } from "./pages/Profile";
import { PageTransition } from "./components/ui/PageTransition";

export type CopilotViewName =
  | "dashboard"
  | "smartReply"
  | "inbox"
  | "agent"
  | "tools"
  | "analytics"
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
 * plus the Analytics/Contacts/Notifications/Settings/Profile pages)
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

          {view === "inbox" && <InboxCenter userId={user.id} onLinkGmail={onLinkGmail} />}

          {view === "agent" && (
            <AgentMode userId={user.id} onSendDraft={onSendDraft} onLinkGmail={onLinkGmail} />
          )}

          {view === "tools" && <AITools onOpenTool={openTool} />}

          {view === "analytics" && <Analytics userId={user.id} onLinkGmail={onLinkGmail} />}
          {view === "contacts" && (
            <Contacts userId={user.id} onCompose={onCompose} onLinkGmail={onLinkGmail} />
          )}
          {view === "notifications" && (
            <Notifications userId={user.id} onLinkGmail={onLinkGmail} />
          )}
          {view === "settings" && (
            <Settings userId={user.id} userEmail={user.email} onLinkGmail={onLinkGmail} onLogout={onLogout} />
          )}
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
