import json
import os
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from urllib.parse import quote_plus

from psycopg import InterfaceError, OperationalError
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


_pool = None


def _conninfo():
    db_url = os.getenv("SUPABASE_DB_URL")
    if db_url:
        return db_url

    password = os.getenv("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError("SUPABASE_DB_URL or POSTGRES_PASSWORD is required for database access.")

    user = os.getenv("POSTGRES_USER", "postgres")
    host = os.getenv("POSTGRES_HOST", "db")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = os.getenv("POSTGRES_DB", "postgres")
    return f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(database)}"


def get_pool():
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            conninfo=_conninfo(),
            min_size=1,
            max_size=int(os.getenv("SUPABASE_DB_POOL_SIZE", "8")),
            kwargs={"row_factory": dict_row},
            check=ConnectionPool.check_connection,
        )
    return _pool


def reset_pool():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def with_db_retry(operation):
    try:
        return operation()
    except (OperationalError, InterfaceError):
        reset_pool()
        return operation()


@contextmanager
def connection():
    with get_pool().connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _prepare_params(params):
    if params is None:
        return ()
    prepared = []
    for value in params:
        if isinstance(value, (dict, list)):
            prepared.append(Jsonb(value, dumps=lambda data: json.dumps(data, ensure_ascii=False)))
        else:
            prepared.append(value)
    return tuple(prepared)


def query(sql, params=None, one=False):
    def operation():
        with connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, _prepare_params(params))
                rows = cursor.fetchall()
                return (rows[0] if rows else None) if one else rows

    return with_db_retry(operation)


def execute(sql, params=None):
    def operation():
        with connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, _prepare_params(params))
                row = cursor.fetchone() if cursor.description else None
                return row["id"] if row and "id" in row else cursor.rowcount

    return with_db_retry(operation)


def executemany(sql, seq):
    def operation():
        with connection() as conn:
            with conn.cursor() as cursor:
                cursor.executemany(sql, [_prepare_params(params) for params in seq])
                return cursor.rowcount

    return with_db_retry(operation)


def ensure_schema():
    """Apply lightweight additive migrations needed by the app."""
    statements = [
        "SELECT pg_advisory_xact_lock(hashtext('scholarx_schema_migrations'))",
        "CREATE EXTENSION IF NOT EXISTS vector",
        "ALTER TABLE public.library_papers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
        "ALTER TABLE public.paper_detail ADD COLUMN IF NOT EXISTS detail_snippet TEXT",
        "ALTER TABLE public.paper_detail ADD COLUMN IF NOT EXISTS pdf_text_preview TEXT",
        "ALTER TABLE public.paper_detail ADD COLUMN IF NOT EXISTS abstract_source VARCHAR(80)",
        "ALTER TABLE public.paper_uploads ADD COLUMN IF NOT EXISTS file_hash VARCHAR(80)",
        "ALTER TABLE public.paper_chunks ADD COLUMN IF NOT EXISTS embedding vector",
        "ALTER TABLE public.paper_chunks ADD COLUMN IF NOT EXISTS embedding_dim INT",
        "CREATE INDEX IF NOT EXISTS idx_paper_uploads_file_hash ON public.paper_uploads(file_hash)",
        "CREATE INDEX IF NOT EXISTS idx_paper_chunks_embedding_model_dim ON public.paper_chunks(embedding_model, embedding_dim)",
        """
        CREATE TABLE IF NOT EXISTS public.paper_tasks (
            id BIGSERIAL PRIMARY KEY,
            library_id INT REFERENCES public.paper_libraries(id) ON DELETE CASCADE,
            type VARCHAR(80) NOT NULL,
            status VARCHAR(40) NOT NULL DEFAULT 'pending',
            input_json JSONB,
            result_json JSONB,
            error TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS public.library_files (
            id BIGSERIAL PRIMARY KEY,
            library_id INT NOT NULL REFERENCES public.paper_libraries(id) ON DELETE CASCADE,
            parent_id BIGINT REFERENCES public.library_files(id) ON DELETE CASCADE,
            name VARCHAR(500) NOT NULL,
            type VARCHAR(40) NOT NULL DEFAULT 'markdown',
            content_text TEXT,
            storage_url VARCHAR(1000),
            metadata_json JSONB,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(library_id, parent_id, name)
        )
        """,
        "ALTER TABLE public.library_files ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'active'",
        "ALTER TABLE public.library_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS idx_paper_tasks_library ON public.paper_tasks(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_library_files_library ON public.library_files(library_id)",
        "CREATE INDEX IF NOT EXISTS idx_library_files_parent ON public.library_files(parent_id)",
        "CREATE INDEX IF NOT EXISTS idx_library_files_status ON public.library_files(status)",
        """
        CREATE TABLE IF NOT EXISTS public.user_writing_preferences (
            id BIGSERIAL PRIMARY KEY,
            user_key VARCHAR(240) NOT NULL UNIQUE,
            style_rules_json JSONB,
            citation_style VARCHAR(80),
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
        """,
        """
        UPDATE public.paper_detail
        SET pdf_text_preview=COALESCE(pdf_text_preview, abstract),
            abstract=NULL
        WHERE abstract IS NOT NULL
          AND pdf_text_preview IS NULL
          AND (
            metadata_json->>'source' = 'pdf_upload'
            OR metadata_json ? 'uploaded_pdf'
            OR metadata_json ? 'pdf_bibliography'
          )
        """,
        """
        UPDATE public.paper_detail
        SET detail_snippet=COALESCE(detail_snippet, abstract),
            abstract=NULL
        WHERE abstract IS NOT NULL
          AND detail_snippet IS NULL
          AND metadata_json ? 'web_results'
        """,
    ]

    def operation():
        with connection() as conn:
            with conn.cursor() as cursor:
                for statement in statements:
                    cursor.execute(statement)

    return with_db_retry(operation)


def to_jsonable(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", "ignore")
    return value


def normalize_row(row):
    if not row:
        return row
    return {key: to_jsonable(value) for key, value in row.items()}


def normalize_rows(rows):
    return [normalize_row(row) for row in rows]
