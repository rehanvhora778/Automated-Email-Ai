import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# Teeno routes ko import karein
from app.api.v1 import chat, actions, auth, reply, inbox, tools, agent, analytics, contacts, notifications, otp
import uvicorn

app = FastAPI(title="Smart Email Agent")

# --- CORS SETTINGS ---
# Iske bina React backend se baat nahi kar payega
# Browsers reject the combination of allow_credentials=True with a "*" origin,
# and it would let any site call this API on a signed-in user's behalf. In
# production set ALLOWED_ORIGINS to the deployed frontend, comma-separated:
#   ALLOWED_ORIGINS=https://your-app.vercel.app,https://www.yourdomain.com
# Unset, it falls back to the local Vite dev servers.
_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",  # vite preview
]
_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = (
    [o.strip().rstrip("/") for o in _origins_env.split(",") if o.strip()]
    if _origins_env
    else _DEV_ORIGINS
)
print(f"CORS allowed origins: {ALLOWED_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Vercel gives every deployment a unique preview URL, so allow those too.
    allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX") or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ROUTERS REGISTER KARNA ---

# 1. Chat (Mistral AI logic)
app.include_router(chat.router, prefix="/api/v1/chat", tags=["Chat"])

# 2. Actions (Gmail Login & Send logic)
app.include_router(actions.router, prefix="/api/v1/actions", tags=["Actions"])

# 4. Auth (Signup that auto-confirms email so login works immediately)
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])

# 5. Smart Reply Generator (six reply styles from a pasted email)
app.include_router(reply.router, prefix="/api/v1/reply", tags=["Reply"])

# 6. AI Inbox Summary (reads recent Gmail -> structured briefing)
app.include_router(inbox.router, prefix="/api/v1/inbox", tags=["Inbox"])

# 7. AI Writing Tools (cover letter, cold email, translate, improve, rewrite)
app.include_router(tools.router, prefix="/api/v1/ai", tags=["AI Tools"])

# 8. AI Agent Mode (streamed multi-step command execution)
app.include_router(agent.router, prefix="/api/v1/agent", tags=["Agent"])

# 9. Email Analytics (real Gmail volume/trend/category/sender stats)
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics"])

# 10. Contacts (real people derived from Gmail senders/recipients)
app.include_router(contacts.router, prefix="/api/v1/contacts", tags=["Contacts"])

# 11. Notifications (real unread Gmail messages + mark-all-read)
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])

# 12. Email OTP (first-party signup / password-reset codes over SMTP)
app.include_router(otp.router, prefix="/api/v1/otp", tags=["OTP"])

@app.get("/")
def home():
    return {"message": "Email Agent Backend is Running!"}

if __name__ == "__main__":
    # Reload=True se code change karte hi server apne aap restart hoga
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)