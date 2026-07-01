from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# Teeno routes ko import karein
from app.api.v1 import chat, profile, actions, auth, reply, inbox, tools, agent
import uvicorn

app = FastAPI(title="Smart Email Agent")

# --- CORS SETTINGS ---
# Iske bina React backend se baat nahi kar payega
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Production mein ise React ke URL se badal denge
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ROUTERS REGISTER KARNA ---

# 1. Chat (Mistral AI logic)
app.include_router(chat.router, prefix="/api/v1/chat", tags=["Chat"])

# 2. Profile (Resume Upload logic)
app.include_router(profile.router, prefix="/api/v1/profile", tags=["Profile"])

# 3. Actions (Gmail Login & Send logic) - YE NAYA HAI
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

@app.get("/")
def home():
    return {"message": "Email Agent Backend is Running!"}

if __name__ == "__main__":
    # Reload=True se code change karte hi server apne aap restart hoga
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)