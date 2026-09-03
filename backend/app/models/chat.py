from pydantic import BaseModel
from typing import Optional

# Ye sirf validation ke liye hai
class ChatRequest(BaseModel):
    user_id: str
    message: str
    conversation_id: Optional[str] = None
    # The browser's local calendar date (YYYY-MM-DD). The server's own clock
    # runs in UTC, which is a day behind for anyone east of it during their
    # evening -- and a draft that says "tomorrow" then carries the wrong date.
    client_date: Optional[str] = None
