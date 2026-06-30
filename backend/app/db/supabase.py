import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# Env variables se keys uthana
url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_KEY")

# Supabase Client initiate karna
supabase: Client = create_client(url, key)

# Helper function user ka data fetch karne ke liye
def get_user_profile(user_id: str):
    response = supabase.table("profiles").select("*").eq("id", user_id).execute()
    return response.data[0] if response.data else None

# Helper function resume fetch karne ke liye
def get_user_resume(user_id: str):
    response = supabase.table("resumes").select("raw_text").eq("user_id", user_id).execute()
    return response.data[0] if response.data else ""