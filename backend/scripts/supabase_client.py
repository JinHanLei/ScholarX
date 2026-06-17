import os

from supabase import create_client


url = os.getenv("SUPABASE_URL")
key = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("ANON_KEY")
)

if not url or not key:
    raise RuntimeError("SUPABASE_URL and Supabase anon/service key are required.")

supabase_client = create_client(url, key)
