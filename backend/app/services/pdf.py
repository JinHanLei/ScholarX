from pathlib import Path
from urllib.parse import urlparse, urlunparse
from uuid import uuid4
import os

from PyPDF2 import PdfReader
from werkzeug.utils import secure_filename

from .supabase_client import get_supabase_client


def save_pdf(file_storage, upload_folder):
    original = secure_filename(file_storage.filename or "paper.pdf")
    filename = f"{uuid4().hex}_{original}"
    path = Path(upload_folder) / filename
    file_storage.save(path)
    return filename, str(path)


def extract_pdf_text(path, max_chars=120000, max_pages=80):
    reader = PdfReader(path)
    parts = []
    for page in reader.pages[:max_pages]:
        text = page.extract_text() or ""
        if text.strip():
            parts.append(text)
        if sum(len(part) for part in parts) >= max_chars:
            break
    return "\n".join(parts).replace("\x00", "")[:max_chars]


def extract_pdf_metadata(path):
    try:
        reader = PdfReader(path)
        metadata = reader.metadata or {}
    except Exception:
        return {}
    values = {}
    for key, value in dict(metadata).items():
        normalized_key = str(key).lstrip("/").lower()
        if value is not None:
            values[normalized_key] = str(value).strip()
    return values


def upload_pdf_to_object_store(path, filename):
    if not os.getenv("SUPABASE_URL"):
        return None, None

    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "scholarx-pdfs")
    key = f"pdfs/{filename}"
    client = get_supabase_client()
    with open(path, "rb") as file:
        client.storage.from_(bucket).upload(
            key,
            file,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
    public = client.storage.from_(bucket).get_public_url(key)
    public_base = os.getenv("SUPABASE_PUBLIC_URL")
    if public_base:
        internal = urlparse(public)
        external = urlparse(public_base)
        public = urlunparse(
            (
                external.scheme or internal.scheme,
                external.netloc or internal.netloc,
                internal.path,
                internal.params,
                internal.query,
                internal.fragment,
            )
        )
    return public, key
