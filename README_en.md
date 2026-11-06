# EasyRef

EasyRef now defaults to a local research workbench using React/Vite, Flask, SQLite/FTS5, Git and the installed Codex app-server. No Docker, Supabase or separate API key is required for local operation. See [local setup and delivery notes](docs/LOCAL_WORKBENCH.md) and the current [quick start](README.md). The deployment instructions below describe the optional legacy Supabase mode (`EASYREF_STORAGE=supabase`, `VITE_EASYREF_LEGACY=true`). Existing data is preserved.

For parallel component development, run `scripts/setup-worktrees.ps1` to create
isolated component branches and directories. Use `scripts/start-component.ps1 -Component idea`
for a separate application instance, ports and data. See [parallel development](docs/PARALLEL_DEVELOPMENT.md).

[![简体中文](https://img.shields.io/badge/简体中文-README-green)](README_zh.md)
[![English](https://img.shields.io/badge/English-README-blue)](README_en.md)

ScholarX is a fully open-source Vibe Scholar platform. If vibe coding makes software building possible without deep coding expertise, then vibe researching should make paper research possible without first becoming a domain expert.

## 1. Features

1. Data sources
    - Paper data: automatically crawled and parsed DBLP data, plus user-uploaded PDFs collected through the browser extension.
    - Ranking data: built-in CCF rankings. Users can also curate their own ranking systems and upload spreadsheets for automatic parsing.
2. Architecture
    - Frontend: React
    - Backend: Python Flask
    - Database and object storage: local or cloud Supabase. Supabase packages PostgreSQL, Auth, REST API, Studio, and Storage into a convenient service layer.
3. Integrations
    - LLM: configurable provider support for OpenAI, Google, Anthropic, and other mainstream APIs. The default direction is DeepSeek-compatible usage.
    - Embedding: configurable provider.
    - Web search: configurable provider, with Bocha as the default.

Main capabilities:

1. Paper library management
    1. Multiple ways to create libraries
        - Search-driven library creation: supports keyword search with filters such as year and ranking level, including built-in CCF rankings. For example, search for `stock + 2026 + CCF A`.
        - Batch PDF upload: supports single PDFs, multiple PDFs, and ZIP files. The backend parses and associates files automatically, then stores PDFs in the Supabase Storage `scholarx-pdfs` bucket.
        - Natural-language search.
    2. Libraries can be edited, organized into subfolders, and used to move or copy papers.
    3. Papers can be manually added to or removed from an existing library.
2. Paper metadata maintenance
    1. Custom tag fields can be used as filters to track reading progress and research clues.
    2. ScholarX automatically collects paper metadata from multiple sources by default, including abstracts and BibTeX. Missing fields can be filled manually in the frontend.
    3. Fallback enrichment: when paper metadata is severely incomplete, web search is used to supplement the paper details.
3. Library sharing: libraries can be shared by user email.
4. Vibe Research: the right-side Agent panel can answer questions about selected papers or the current library. When one or more documents are provided, questions are routed into several modes:
    1. In-Paper QA
        - The answer exists in the paper and does not require extra reasoning, such as "What is the innovation?"
        - Examples: "What is the innovation?" "What dataset was used in the experiments?"
        - Strategy: RAG (Keyword + Embedding) plus faithful generation.
    2. Beyond-Paper Reasoning
        - The answer is not directly present in the paper and requires reasoning, critique, extension, or new ideas based on the source material.
        - Examples: "What are the limitations of this method?" "How can it be improved?"
        - Strategy: retrieval assistance plus deeper LLM reasoning.
    3. Generative Creation
        - The user asks for a non-text artifact such as an image, PPT, mind map, or chart.
        - Examples: "Draw the model architecture." "Generate presentation slides from this paper."
        - Strategy: call the corresponding multimodal generation tools.
    4. Orchestrated Task
        - Complex tasks are decomposed into subtasks, routed to the modes above, and then integrated.
        - Examples: "Help me write a literature review about XX." "Write a paper about xxx."
        - Strategy: task planning -> subtask decomposition -> route to modes 1/2/3 -> synthesize the final output.
5. Browser extension: PDFs can be saved directly into a paper library from a PDF page or PDF link.

## 2. Deployment

### 1. Prepare the Environment

Install:

- Docker
- Docker Compose

To customize ports, model settings, search services, or a cloud Supabase project, copy and edit the environment file first:

```bash
cp .env.example .env
```

LLM and Embedding configuration. Supported `LLM_PROTOCOL` values include `anthropic`, `openai`, and `google`:

```env
LLM_PROTOCOL=openai
LLM_BASE_URL=https://your-llm-provider.example/v1
LLM_API_KEY=
LLM_MODEL=your-model
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
```

If `LLM_API_KEY` is not configured, the chat endpoint returns a placeholder response so the frontend can still be tested. Embedding uses an OpenAI-compatible `/v1/embeddings` endpoint. If `EMBEDDING_BASE_URL` or `EMBEDDING_API_KEY` is empty, ScholarX reuses `LLM_BASE_URL` and `LLM_API_KEY`.

Web search configuration. Paper detail enrichment uses Bocha by default and falls back to `ddgs` if Bocha is not configured or the request fails:

```env
WEB_SEARCH_PROVIDER=bocha
WEB_SEARCH_RESULT_COUNT=10
WEB_SEARCH_CONCURRENCY=10
BOCHA_API_KEY=
BOCHA_SEARCH_URL=https://api.bocha.cn/v1/web-search
BOCHA_FRESHNESS=noLimit
BOCHA_SUMMARY=true
```

To force DuckDuckGo search, set:

```env
WEB_SEARCH_PROVIDER=ddgs
```

If you do not want to use the local Supabase stack, configure a cloud Supabase project in the root `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=postgresql://postgres.your-project:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
```

After these values are set, the backend uses the cloud Supabase project instead of the default `http://kong:8000`.

### 2. Start the Services

Run this from the project root:

```bash
docker compose up --build
```

After startup, open:

- Frontend: http://localhost:5180
- Backend health check: http://localhost:5000/health
- Supabase Studio / API Gateway: http://localhost:8000

Supabase Studio uses `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` from `db/supabase/.env`.

The local Supabase configuration is synchronized with the current official self-hosting Docker version. Existing data uses PostgreSQL 15, so the root Compose file layers `db/supabase/docker-compose.pg15.yml` to stay on the official PG15 compatibility image. Do not mount this data directory into a PostgreSQL 17 image directly.

### 3. Initialize the Supabase Schema

After Supabase starts for the first time and the services are healthy, apply the schema once:

```bash
docker compose --profile init run --rm scholarx-schema
```

This command applies `db/schema.sql`, creating the tables, RLS policies, indexes, and Storage bucket required by ScholarX. Run it again whenever `db/schema.sql` changes.

### 4. Initialize DBLP and CCF Data

The default initialization process downloads DBLP, parses it with `backend/scripts/insert_dblp.py`, and imports the bundled CCF CSV:

```bash
docker compose run --rm backend python scripts/init_data.py
```

If you already have `dblp.xml` and `dblp.dtd`, place them in the root `dblp` folder and skip the download:

```bash
docker compose run --rm backend python scripts/init_data.py --skip-download
```

To import only the CCF CSV:

```bash
docker compose run --rm backend python scripts/insert_venue.py /app/ccf_2022_with_dblp_key.csv
```

DBLP is large, so the import can take significant time and memory.

Optional search optimization: if title fuzzy search is slow after a full DBLP import, create an additional trigram index in the Supabase Studio SQL Editor:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_title_trgm ON public.papers USING GIN (title gin_trgm_ops);
```

This index is optional. It improves title similarity and fuzzy matching, but it can take a long time to build on large tables. Create it after the full DBLP import completes.

Scheduled DBLP refresh: the `scheduler` service can periodically download and import DBLP. The default timezone is `Asia/Shanghai`; enable it in the root `.env`:

```env
SCHEDULE_DBLP_ENABLED=true
SCHEDULE_DBLP_WEEKDAY=6
SCHEDULE_DBLP_HOUR=23
SCHEDULE_DBLP_MINUTE=30
SCHEDULE_DBLP_SKIP_CCF=true
```

This configuration runs every Sunday at 23:30. Before downloading, the script compares the official DBLP MD5 file with the last successful `./dblp/dblp.xml.gz.md5`; if the MD5 is unchanged, it skips both the DBLP download and import.

### 5. Load the Browser Extension

Chrome or Edge can load the extension from the `browser-extension` directory:

1. Start ScholarX first. The default extension API address is `http://localhost:5000/api`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked" and select the `browser-extension` directory from this project.
5. Open ScholarX and select a paper library, or select a library from the extension popup.

Usage:

- On a PDF page, click the ScholarX extension button and choose "保存 PDF".
- On a PDF link, right-click and choose "保存链接 PDF 到 ScholarX".

The extension calls the existing upload endpoint:

```text
POST /api/libraries/<library_id>/uploads/pdf?async=1
```
