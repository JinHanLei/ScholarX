-- 开发环境重置 - 生产环境请勿使用
DROP TABLE IF EXISTS public.search_results CASCADE;
DROP TABLE IF EXISTS public.search_tasks CASCADE;
DROP TABLE IF EXISTS public.papers CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. 用户配置表
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE,
    nickname VARCHAR(100),
    avatar_url VARCHAR(500),
    membership_type VARCHAR(20) DEFAULT 'free' CHECK (membership_type IN ('free', 'premium')),
    membership_expires_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. 搜索任务表
CREATE TABLE IF NOT EXISTS public.search_tasks (
    session_id UUID PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    keyword VARCHAR(200) NOT NULL,
    year_low INTEGER,
    year_high INTEGER,
    limit_num INTEGER DEFAULT 50,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'cancelled', 'error')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. 论文表
CREATE TABLE IF NOT EXISTS public.papers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    authors TEXT,
    description TEXT,
    pub_year INTEGER,
    num_citations INTEGER DEFAULT 0,
    bib TEXT,
    pub_url VARCHAR(1000),
    bib_url VARCHAR(1000),
    citedby_url VARCHAR(1000),
    abstract TEXT,
    keywords TEXT,
    doi VARCHAR(255),
    pdf_url VARCHAR(1000),
    file_hash VARCHAR(100),
    file_size BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. 搜索结果表
CREATE TABLE IF NOT EXISTS public.search_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    paper_id UUID NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
    result_index INTEGER NOT NULL,  -- 结果中的位置
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_search_tasks_user_id ON public.search_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_search_tasks_status ON public.search_tasks(status);
CREATE INDEX IF NOT EXISTS idx_papers_title ON public.papers USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON public.papers(doi);
CREATE INDEX IF NOT EXISTS idx_search_results_session_id ON public.search_results(session_id);
CREATE INDEX IF NOT EXISTS idx_search_results_paper_id ON public.search_results(paper_id);

-- RLS 策略
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户可管理自己的资料" ON public.user_profiles
    FOR ALL USING (auth.uid() = id);

ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "公开论文元数据" ON public.papers FOR SELECT USING (true);
CREATE POLICY "认证用户可插入论文" ON public.papers
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

ALTER TABLE public.search_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户可管理自己的搜索任务" ON public.search_tasks
    FOR ALL USING (auth.uid() = user_id);

-- supabase上传/下载权限
CREATE POLICY "Enable insert for authenticated users" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'papers' AND auth.role() = 'authenticated');

CREATE POLICY "Enable read access for all users" ON storage.objects FOR SELECT
USING (bucket_id = 'papers' AND auth.role() = 'authenticated');