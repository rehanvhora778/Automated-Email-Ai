import os
import json
from mistralai import Mistral
from dotenv import load_dotenv

load_dotenv()

class SecretaryAI:
    def __init__(self):
        api_key = os.getenv("MISTRAL_API_KEY")
        self.model = "mistral-medium-latest" 
        self.client = Mistral(api_key=api_key)

    def generate_response(self, user_input, profile_data, resume_context, chat_history=[]):
        # User details setup
        user_name = profile_data.get('full_name', 'User')
        signature = profile_data.get('signature') or f"Best regards,\n{user_name}"
        
        system_instructions = f"""
        You are an Smart Email Assistant. 
        USER PROFILE: {json.dumps(profile_data)}
        RESUME: {resume_context[:1000]}

        CORE LOGIC:
        1. IDENTIFY INTENT: Determine the user's LATEST request goal (e.g., writing a specific email).
        2. TASK ISOLATION: Focus ONLY on the latest request. Ignore specific data requirements (like flight numbers or dates) from previous, unrelated tasks in the chat history.
        3. DATA VALIDATION: 
           - If the current task needs specific details (names, dates, numbers) that are NOT in the message or profile, set "status": "missing_info".
           - Do NOT use placeholders like [Company Name] or [Date]. If you don't have them, ASK for them.
        4. DRAFTING: If all info is present, generate a high-quality draft using the user's resume for personalization.
        5. SIGNATURE: End the draft strictly with:
        {signature}

        RESPONSE FORMAT (Strict JSON):
        {{
            "status": "ready" | "missing_info",
            "content": "Final draft OR a polite request for missing details",
            "metadata": {{ "subject": "...", "type": "..." }}
        }}
        """
        # ... baaki code same ...
        # ... baaki messages aur client.chat.complete wala code same rahega ...

        # --- MEMORY LOGIC START ---
        # 1. Sabse pehle System Instructions daalo
        messages = [{"role": "system", "content": system_instructions}]

        # 2. Phir purani chat history add karo (taaki AI ko pichli baatein yaad rahein)
        for msg in chat_history:
            messages.append({
                "role": msg["role"], 
                "content": msg["content"]
            })

        # 3. Sabse aakhiri mein user ka naya sawal daalo
        messages.append({"role": "user", "content": user_input})
        # --- MEMORY LOGIC END ---

        try:
            # Mistral API call
            response = self.client.chat.complete(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"}
            )
            
            raw_content = response.choices[0].message.content
            return json.loads(raw_content)

        except json.JSONDecodeError:
            print("AI ne JSON format nahi diya.")
            return {
                "status": "ready",
                "content": response.choices[0].message.content,
                "metadata": {}
            }
            
        except Exception as e:
            print(f"MISTRAL API ERROR: {e}")
            return {
                "status": "error",
                "content": "Mistral AI is busy. Try again.",
                "metadata": {}
            }