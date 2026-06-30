from pydantic import BaseModel
from typing import Optional

# Ye sirf validation ke liye hai
class ChatRequest(BaseModel):
    user_id: str
    message: str
    conversation_id: Optional[str] = None
