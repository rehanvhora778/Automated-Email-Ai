from pydantic import BaseModel, Field
from typing import Optional

# Ye sirf validation ke liye hai
class ChatRequest(BaseModel):
    # The message is forwarded to Mistral, so it is bounded here: an oversized
    # body is rejected by validation rather than spending the shared quota.
    message: str = Field(..., max_length=20000)
    conversation_id: Optional[str] = None
    # The browser's local calendar date (YYYY-MM-DD). The server's own clock
    # runs in UTC, which is a day behind for anyone east of it during their
    # evening -- and a draft that says "tomorrow" then carries the wrong date.
    client_date: Optional[str] = None
