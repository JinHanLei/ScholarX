# EasyRef

EasyRef is a React + Flask paper library app built around DBLP, CCF rankings, PDF uploads, web detail enrichment, and an agent chat workflow. The development stack now includes a local self-hosted Supabase bundle for PostgreSQL, Auth, REST, Studio, and Storage.

## What Is Included

- Left pane: paper libraries, dynamic/static mode, library creation from search, and sharing by user email.
- Middle pane: paper table, filtering, add/remove, tag columns, detail enrichment, and PDF upload.
- Right pane: agent chat over selected papers or the current library, with OpenAI-compatible model support.
- Docker Compose: Supabase, Flask API, React frontend, and weekly DBLP scheduler.
- Supabase Storage: uploaded PDFs go into the `easyref-pdfs` bucket.
- DBLP import compatibility: scripts live under `backend/scripts` and follow the original streaming + Supabase upsert design.

## Start

The root `docker-compose.yml` includes `supabase/er_supabase/docker-compose.yml`, so one command starts both Supabase and EasyRef.

```bash
docker compose up --build
```

Open:

- Frontend: http://localhost:5180
- Backend health: http://localhost:5000/health
- Supabase Studio / API gateway: http://localhost:8000

Studio login uses `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` from `supabase/er_supabase/.env`.

## Local Supabase

The app connects to the local Supabase services inside Docker:

- Supabase API: `http://kong:8000`
- PostgreSQL: `db:5432`
- Storage bucket: `easyref-pdfs`

`easyref-schema` is a one-off Compose service for applying `supabase/schema.sql`. The schema creates the EasyRef tables, RLS policies, indexes, and Storage bucket.

Run it once after Supabase is healthy, or rerun it whenever `supabase/schema.sql` changes:

```bash
docker compose --profile init run --rm easyref-schema
```

For a hosted Supabase project, fill the cloud values in the root `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=postgresql://postgres.your-project:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
```

When these are set, the backend uses the hosted Supabase project instead of the local default URL.

## Initialize Data

By default, initialization downloads DBLP, parses it with `scripts/insert_dblp.py`, and imports the bundled CCF CSV with `scripts/insert_venue.py`:

```bash
docker compose run --rm backend python scripts/init_data.py
```

If you already have `dblp.xml` and `dblp.dtd`, place them under `./dblp` and skip the download:

```bash
docker compose run --rm backend python scripts/init_data.py --skip-download
```

To import only the CCF CSV:

```bash
docker compose run --rm backend python scripts/insert_venue.py /app/ccf_2022_with_dblp_key.csv
```

The app can also trigger the same pipeline through:

- `POST /api/admin/data-init`
- `POST /api/admin/dblp-update`

## Scheduled DBLP Refresh

The `scheduler` service runs the DBLP download and import every Sunday at 23:30 in `Asia/Shanghai` by default:

```env
SCHEDULE_DBLP_ENABLED=true
SCHEDULE_DBLP_WEEKDAY=6
SCHEDULE_DBLP_HOUR=23
SCHEDULE_DBLP_MINUTE=30
SCHEDULE_DBLP_SKIP_CCF=true
```

Before downloading the large DBLP XML file, `scripts/download_dblp.py` downloads the official MD5 file and compares it with `./dblp/dblp.xml.gz.md5` from the last successful run. If the MD5 is unchanged, it skips both the DBLP download and the DBLP insert step. The MD5 file is preserved for the next run.

Duplicate rows are skipped by Supabase/PostgreSQL unique keys plus Supabase upsert logic:

- `papers.dblp_key` is unique.
- `venues.dblp_detail_key` is unique.
- `category_venue_rankings(category_id, venue_id)` is unique.

The DBLP import is still heavy because DBLP contains millions of records. Prefer `docker compose run --rm backend ...` for imports instead of `docker compose exec backend ...`; the one-off container does not share memory with the web API process.

## Search Indexes

During the first full DBLP import, title search indexes are intentionally not built. After the import completes, run these in Supabase Studio SQL editor:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS papers_title_tsvector_idx ON public.papers USING GIN (fts);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_title_trgm ON public.papers USING GIN (title gin_trgm_ops);
```

## Object Storage

Uploaded PDFs are parsed locally and uploaded to Supabase Storage. The schema creates the `easyref-pdfs` bucket if it does not already exist.

## LLM Provider

Set these in the root `.env`. Supported protocols are `anthropic`, `openai`, and `google`:

```env
LLM_PROTOCOL=openai
LLM_BASE_URL=https://your-llm-provider.example/v1
LLM_API_KEY=...
LLM_MODEL=your-model
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
```

Without `LLM_API_KEY`, chat returns a placeholder response so the UI can still be tested.
Embedding uses an OpenAI-compatible `/v1/embeddings` endpoint. If `EMBEDDING_BASE_URL` or `EMBEDDING_API_KEY` are empty, EasyRef reuses `LLM_BASE_URL` and `LLM_API_KEY`.

## Web Search Provider

Paper detail enrichment uses Bocha web search by default and falls back to `ddgs` if Bocha is not configured or the request fails:

```env
WEB_SEARCH_PROVIDER=bocha
WEB_SEARCH_RESULT_COUNT=10
WEB_SEARCH_CONCURRENCY=10
BOCHA_API_KEY=...
BOCHA_SEARCH_URL=https://api.bocha.cn/v1/web-search
BOCHA_FRESHNESS=noLimit
BOCHA_SUMMARY=true
```

Set `WEB_SEARCH_PROVIDER=ddgs` to force DuckDuckGo search.

## Skills

The Agent pane has a Skills button next to chat history. Skills are listed from `backend/skills/catalog.json`; installing a skill records state in `backend/data/installed_skills.json`, and enabled skills are injected into the chat agent prompt.

To add a development-time skill, append a catalog item:

```json
{
  "id": "ppt-master",
  "name": "ppt-master",
  "source_url": "https://github.com/hugohe3/ppt-master/tree/main",
  "category": "presentation",
  "description": "将论文、论文库或综述内容整理成 PPT 大纲与逐页讲稿。",
  "entrypoint": "agent_prompt",
  "prompt": "你的 skill 指令..."
}
```

The bundled `ppt-master` entry adds a paper-to-PPT workflow for the Agent. For executable skills, keep code under `backend/skills/<skill-id>/` and extend the skill service with a matching `entrypoint`.

## API Shape

- `GET /api/papers/search`: keyword/year/rank search over DBLP data.
- `POST /api/libraries`: create a dynamic/static library and optionally seed papers.
- `PATCH /api/libraries/<id>`: update library metadata, mode, filters, and shared user emails.
- `POST /api/libraries/<id>/sync`: refresh a dynamic library from its filters.
- `GET /api/libraries/<id>/papers`: load table data.
- `PATCH /api/libraries/<id>/papers/<paper_id>`: update tags, status, notes, and custom columns.
- `POST /api/papers/<paper_id>/details`: enrich details through Bocha web search with `ddgs` fallback.
- `POST /api/uploads/pdf`: upload and parse a PDF.
- `POST /api/chat`: answer with selected papers or library context.
