import os
import base64
from email.message import EmailMessage
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

class GmailService:
    @staticmethod
    def send_email(subject, body, to_email):
        # Note: Asli app mein hum token database se uthayenge.
        # Abhi testing ke liye hum token.json file use karenge jo pehli baar login pe banegi.
        if not os.path.exists('token.json'):
            return "Error: Please authenticate with Google first."

        creds = Credentials.from_authorized_user_file('token.json')
        service = build('gmail', 'v1', credentials=creds)

        message = EmailMessage()
        message.set_content(body)
        message['To'] = to_email
        message['Subject'] = subject

        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        create_message = {'raw': encoded_message}

        try:
            service.users().messages().send(userId="me", body=create_message).execute()
            return "Success"
        except Exception as e:
            return f"Error: {e}"