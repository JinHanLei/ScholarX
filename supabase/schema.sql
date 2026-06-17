-- EasyRef Supabase schema.
-- Run this in the Supabase SQL editor before starting the app/importer.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE,
    category_description TEXT,
    discipline VARCHAR(100),
    rank_list JSONB
);

CREATE TABLE IF NOT EXISTS public.venues (
    id SERIAL PRIMARY KEY,
    dblp_key VARCHAR(300),
    dblp_detail_key VARCHAR(300) UNIQUE,
    venue_name VARCHAR(3000),
    venue_details JSONB,
    venue_abbr VARCHAR(50),
    venue_url VARCHAR(1000),
    publisher VARCHAR(200),
    dblp_url VARCHAR(1000),
    cn_number VARCHAR(50),
    joc INT,
    main_venue_id INT REFERENCES public.venues(id) ON DELETE SET NULL,
    is_main BOOLEAN
);

CREATE TABLE IF NOT EXISTS public.category_venue_rankings (
    id SERIAL PRIMARY KEY,
    category_id INT REFERENCES public.categories(id) ON DELETE CASCADE,
    venue_id INT REFERENCES public.venues(id) ON DELETE CASCADE,
    rank VARCHAR(20) NOT NULL,
    UNIQUE(category_id, venue_id)
);

CREATE TABLE IF NOT EXISTS public.papers (
    id SERIAL PRIMARY KEY,
    ref_venue INT REFERENCES public.venues(id) ON DELETE SET NULL,
    dblp_key VARCHAR(300) UNIQUE,
    title VARCHAR(3000) NOT NULL,
    authors JSONB,
    pub_year INTEGER,
    pub_url VARCHAR(1000),
    doi_url VARCHAR(1000),
    paper_details JSONB,
    embedding vector(512),
    fts tsvector GENERATED ALWAYS AS (to_tsvector('english', title)) STORED,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.paper_detail (
    id SERIAL PRIMARY KEY,
    paper_id INTEGER UNIQUE REFERENCES public.papers(id) ON DELETE CASCADE,
    abstract TEXT,
    abstract_source VARCHAR(80),
    detail_snippet TEXT,
    bib TEXT,
    pdf_url VARCHAR(1000),
    pdf_text_preview TEXT,
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.paper_libraries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    mode VARCHAR(20) NOT NULL DEFAULT 'static' CHECK (mode IN ('dynamic', 'static')),
    is_shared BOOLEAN NOT NULL DEFAULT false,
    owner_name VARCHAR(120) NOT NULL DEFAULT 'local',
    owner_id UUID REFERENCES auth.users(id),
    filters_json JSONB,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.paper_libraries ALTER COLUMN mode SET DEFAULT 'static';

CREATE TABLE IF NOT EXISTS public.library_papers (
    id SERIAL PRIMARY KEY,
    library_id INT NOT NULL REFERENCES public.paper_libraries(id) ON DELETE CASCADE,
    paper_id INT NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
    tags_json JSONB,
    notes TEXT,
    status VARCHAR(40) DEFAULT 'active',
    user_columns_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(library_id, paper_id)
);

CREATE TABLE IF NOT EXISTS public.paper_uploads (
    id SERIAL PRIMARY KEY,
    paper_id INT REFERENCES public.papers(id) ON DELETE SET NULL,
    library_id INT REFERENCES public.paper_libraries(id) ON DELETE SET NULL,
    filename VARCHAR(500) NOT NULL,
    original_filename VARCHAR(500),
    file_path VARCHAR(1000) NOT NULL,
    extracted_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.paper_chunks (
    id BIGSERIAL PRIMARY KEY,
    paper_id INT REFERENCES public.papers(id) ON DELETE CASCADE,
    upload_id INT REFERENCES public.paper_uploads(id) ON DELETE CASCADE,
    chunk_no INT NOT NULL,
    language VARCHAR(20),
    text TEXT NOT NULL,
    token_count INT,
    embedding_model VARCHAR(200),
    embedding_json JSONB,
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(upload_id, chunk_no)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id SERIAL PRIMARY KEY,
    library_id INT REFERENCES public.paper_libraries(id) ON DELETE SET NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

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
);

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
);

CREATE TABLE IF NOT EXISTS public.user_writing_preferences (
    id BIGSERIAL PRIMARY KEY,
    user_key VARCHAR(240) NOT NULL UNIQUE,
    style_rules_json JSONB,
    citation_style VARCHAR(80),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_metadata (
    key TEXT PRIMARY KEY,
    value_json JSONB,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.app_metadata (key, value_json)
SELECT 'dblp_last_inserted_at', jsonb_build_object('inserted_at', MAX(created_at))
FROM public.papers
WHERE dblp_key NOT LIKE 'upload/%'
HAVING MAX(created_at) IS NOT NULL
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_categories_category_name ON public.categories(category_name);
CREATE INDEX IF NOT EXISTS idx_venues_joc ON public.venues(joc);
CREATE INDEX IF NOT EXISTS idx_venues_main_venue_id ON public.venues(main_venue_id);
CREATE INDEX IF NOT EXISTS idx_venues_dblp_key ON public.venues(dblp_key);
CREATE INDEX IF NOT EXISTS idx_venues_id_dblp_detail ON public.venues(id, dblp_detail_key);
CREATE INDEX IF NOT EXISTS idx_cvr_rank ON public.category_venue_rankings(rank);
CREATE INDEX IF NOT EXISTS idx_cvr_composite ON public.category_venue_rankings(category_id, rank, venue_id);
CREATE INDEX IF NOT EXISTS idx_papers_ref_venue ON public.papers(ref_venue);
CREATE INDEX IF NOT EXISTS idx_papers_pub_year ON public.papers(pub_year);
CREATE INDEX IF NOT EXISTS papers_title_tsvector_idx ON public.papers USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_venues_name_trgm ON public.venues USING GIN(venue_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_venues_abbr_trgm ON public.venues USING GIN(venue_abbr gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_venues_dblp_key_trgm ON public.venues USING GIN(dblp_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_library_papers_library ON public.library_papers(library_id);
CREATE INDEX IF NOT EXISTS idx_library_papers_paper ON public.library_papers(paper_id);
CREATE INDEX IF NOT EXISTS idx_library_papers_status ON public.library_papers(status);
CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper ON public.paper_chunks(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_chunks_upload ON public.paper_chunks(upload_id);
CREATE INDEX IF NOT EXISTS idx_paper_tasks_library ON public.paper_tasks(library_id);
CREATE INDEX IF NOT EXISTS idx_library_files_library ON public.library_files(library_id);
CREATE INDEX IF NOT EXISTS idx_library_files_parent ON public.library_files(parent_id);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_title_trgm ON public.papers USING GIN(title gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_papers_updated_at'
          AND tgrelid = 'public.papers'::regclass
    ) THEN
        CREATE TRIGGER trg_papers_updated_at BEFORE UPDATE ON public.papers
        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_paper_detail_updated_at'
          AND tgrelid = 'public.paper_detail'::regclass
    ) THEN
        CREATE TRIGGER trg_paper_detail_updated_at BEFORE UPDATE ON public.paper_detail
        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_paper_libraries_updated_at'
          AND tgrelid = 'public.paper_libraries'::regclass
    ) THEN
        CREATE TRIGGER trg_paper_libraries_updated_at BEFORE UPDATE ON public.paper_libraries
        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END
$$;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_venue_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read categories" ON public.categories;
DROP POLICY IF EXISTS "public read venues" ON public.venues;
DROP POLICY IF EXISTS "public read rankings" ON public.category_venue_rankings;
DROP POLICY IF EXISTS "public read papers" ON public.papers;
DROP POLICY IF EXISTS "public read paper_detail" ON public.paper_detail;
DROP POLICY IF EXISTS "service manages categories" ON public.categories;
DROP POLICY IF EXISTS "service manages venues" ON public.venues;
DROP POLICY IF EXISTS "service manages rankings" ON public.category_venue_rankings;
DROP POLICY IF EXISTS "service manages papers" ON public.papers;
DROP POLICY IF EXISTS "service manages paper_detail" ON public.paper_detail;
DROP POLICY IF EXISTS "service manages app tables" ON public.paper_libraries;
DROP POLICY IF EXISTS "service manages library papers" ON public.library_papers;
DROP POLICY IF EXISTS "service manages uploads" ON public.paper_uploads;
DROP POLICY IF EXISTS "public read chunks" ON public.paper_chunks;
DROP POLICY IF EXISTS "service manages chunks" ON public.paper_chunks;
DROP POLICY IF EXISTS "service manages chat" ON public.chat_messages;
DROP POLICY IF EXISTS "service manages metadata" ON public.app_metadata;

CREATE POLICY "public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "public read venues" ON public.venues FOR SELECT USING (true);
CREATE POLICY "public read rankings" ON public.category_venue_rankings FOR SELECT USING (true);
CREATE POLICY "public read papers" ON public.papers FOR SELECT USING (true);
CREATE POLICY "public read paper_detail" ON public.paper_detail FOR SELECT USING (true);
CREATE POLICY "public read chunks" ON public.paper_chunks FOR SELECT USING (true);

CREATE POLICY "service manages categories" ON public.categories FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages venues" ON public.venues FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages rankings" ON public.category_venue_rankings FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages papers" ON public.papers FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages paper_detail" ON public.paper_detail FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages app tables" ON public.paper_libraries FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages library papers" ON public.library_papers FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages uploads" ON public.paper_uploads FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages chunks" ON public.paper_chunks FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages chat" ON public.chat_messages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service manages metadata" ON public.app_metadata FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

INSERT INTO storage.buckets (id, name, "public")
VALUES ('easyref-pdfs', 'easyref-pdfs', true)
ON CONFLICT (id) DO UPDATE SET "public" = EXCLUDED."public";

INSERT INTO storage.buckets (id, name, "public")
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET "public" = EXCLUDED."public";

DROP POLICY IF EXISTS "public reads avatars" ON storage.objects;
DROP POLICY IF EXISTS "users upload own avatars" ON storage.objects;
DROP POLICY IF EXISTS "users update own avatars" ON storage.objects;
DROP POLICY IF EXISTS "users delete own avatars" ON storage.objects;

CREATE POLICY "public reads avatars" ON storage.objects
FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "users upload own avatars" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users update own avatars" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users delete own avatars" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
