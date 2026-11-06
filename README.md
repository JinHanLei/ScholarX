# EasyRef

EasyRef 默认提供本地科研工作台：**Literature → Idea → Experiment → Paper → Review**，共用 Research Project、Codex 会话和证据关联。采用 React/Vite + Flask + SQLite/FTS5 + Git + 本地文件，不要求 Docker、Supabase 或独立 API Key。

## 本地启动（Windows）

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-local.txt
npm --prefix frontend ci
npm --prefix frontend run build
.\.venv\Scripts\python.exe backend/run_local.py
```

打开 **http://127.0.0.1:5000**。也可以运行 `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1`。先安装 Git 和 Codex CLI 并执行 `codex login`；只有调用 Assistant 时需要 Codex，其他核心数据功能可离线使用。开发时另开终端运行 `npm --prefix frontend run dev`，访问 `http://127.0.0.1:5180`。

默认数据保存在项目根目录 `.easyref/`；可以用 `--data-dir D:/EasyRefData` 指定独立目录。LaTeX 源码、大纲、版本与 PDF 阅读可直接使用；PDF 编译自动探测本机 TeX Live/MiKTeX，以及 Codex 自带的 Tectonic；也可通过 `EASYREF_LATEX_BIN` 指定可执行文件。

完整架构、数据库迁移、API、数据备份、验收结果及明确限制见 [本地工作台交付说明](docs/LOCAL_WORKBENCH.md)。自动化测试：

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
# 真实 Codex 调用（会使用已登录账号，创建独立 TEST DATA 项目）
.\.venv\Scripts\python.exe backend/scripts/smoke_codex.py --review
```

## 多组件并行开发

Idea 支持可编辑模型画布、原生可编辑 PPT 导出，以及与 Experiment 共用的自动版本流程。
模型图下方保留设计说明和版本记录；Codex 聊天通过本地接口更新画布。
接入方式与执行边界见 [Idea 画布说明](docs/IDEA_CANVAS.md)。

Literature、Idea、Experiment、Paper、Review 和个人中心各自使用独立 Git worktree。
运行 `scripts/setup-worktrees.ps1` 创建目录与分支，运行
`scripts/start-component.ps1 -Component idea` 启动对应组件的独立开发实例。
端口、数据隔离、AI 任务目录和合并流程见 [并行开发说明](docs/PARALLEL_DEVELOPMENT.md)。

## 旧部署说明（兼容保留）

以下是原有 Supabase 部署与功能文档。仅需继续运行旧部署时设置 `EASYREF_STORAGE=supabase`，并在前端构建时设置 `VITE_EASYREF_LEGACY=true`；其依赖仍见 `backend/requirements.txt`。本地模式不加载这些云端 SDK 或 API-Key Agent。原有数据不会被自动删除或覆盖。

[![简体中文](https://img.shields.io/badge/简体中文-README-green)](README.md)
[![English](https://img.shields.io/badge/English-README-blue)](README_en.md)

全开源的 Vibe Scholar 平台。既然不懂代码可以 Vibe Coding，那么不懂论文也可以 Vibe Researching。

## 一、项目功能

1. 数据源
    - 论文数据：来自自动爬取、解析DBLP数据 + 用户自主上传pdf（提供插件抓取）
    - 等级分类：CCF分级，用户也可以自己梳理分级、上传表格文件自动解析
2. 架构
    - 前端：React
    - 后端：Python Flask
    - 数据库与对象存储：本地或云端Supabase。封装了PostgreSQL、Auth、REST API、Studio和Storage等功能，直接调用非常方便
3. 接口调用
    - LLM：自主定义提供商，支持OpenAI、Google、Anthropic等主流接口，默认deepseek
    - Embedding：自主定义提供商
    - 网络检索：自主定义提供商，默认Bocha

主要功能包括：

1. 论文库管理
    1. 多种论文库构建方式
        - 条件检索生成论文库：支持多样的关键词检索，条件包含年份、等级（内置CCF），例如，可以检索 stock + 26年 + CCF A 的论文。
        - PDF批量上传：支持单个、多个PDF以及ZIP等格式上传，自动解析-关联论文。后端解析文件并将PDF存入Supabase Storage的 `scholarx-pdfs` bucket。
        - 自然语言检索
    2. 论文库支持编辑修改，支持建立子文件夹，允许论文移动/复制
    3. 可在此论文库中继续手动添加或移除论文
2. 论文元数据维护
    1. tag字段可以自定义筛选条件，便于整理阅读进度和研究线索
    2. 默认自动从多源抓取论文源信息，包括abstract、bib等，若未抓到可在前端手动补充
    2. 保底机制：对于信息完全缺失的论文，将通过网页搜索补全论文相关详情
3. 论文库共享：支持按用户邮箱共享论文库
4. Vibe Research：右侧 Agent 面板可基于选中的论文或当前论文库进行问答，问答功能在传入单个/多个文档后，可分为以下几类，由不同路由调用
    1. 原文检索型 (In-Paper QA)
        - 答案存在于论文中，不需要额外推理，比如“创新点是什么”
        - 示例："创新点是什么？""实验用了什么数据集？"
        - 策略：RAG (Keyword+Embedding) + 忠实生成
    2. 知识推理型 (Beyond-Paper Reasoning)
        - 答案不存在于原文，需基于原文进行推理、批判、扩展或提出新想法
        - 示例："这个方法有什么局限性？""如何改进？"
        - 策略：检索辅助 + LLM 深层推理
    3. 生成创作型 (Generative Creation)
        - 要求输出非纯文本的实体，如图片、PPT、思维导图、图表等
        - 示例："画出模型架构图。""根据论文生成讲解PPT。"
        - 策略：调用对应的多模态生成工具
    4. 编排规划型 (Orchestrated Task)
        - 复杂任务，需分解为多个子问题，依次或并行调用上述三种能力
        - 示例："帮我写一篇关于XX的文献综述。""写一篇有关xxx的论文"
        - 策略：任务规划 → 分解子任务 → 路由子任务到 1/2/3 → 整合输出
5. 浏览器扩展：可从PDF页面或PDF链接直接保存到论文库

## 二、部署方法

### 1. 准备环境

需要先安装：

- Docker
- Docker Compose

自定义端口、模型、搜索服务或 Supabase 云端项目，请先复制并修改环境变量：

```bash
cp .env.example .env
```

LLM 与 Embedding 配置。支持的 `LLM_PROTOCOL` 包括 `anthropic`、`openai` 和 `google`：

```env
LLM_PROTOCOL=openai
LLM_BASE_URL=https://your-llm-provider.example/v1
LLM_API_KEY=
LLM_MODEL=your-model
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
```

如果未配置 `LLM_API_KEY`，聊天接口会返回占位响应，前端仍可用于界面测试。Embedding 使用 OpenAI 兼容的 `/v1/embeddings` 接口；如果 `EMBEDDING_BASE_URL` 或 `EMBEDDING_API_KEY` 为空，会复用 `LLM_BASE_URL` 和 `LLM_API_KEY`。

网页搜索配置。论文详情补全默认使用 Bocha，并在未配置或请求失败时回退到 `ddgs`：

```env
WEB_SEARCH_PROVIDER=bocha
WEB_SEARCH_RESULT_COUNT=10
WEB_SEARCH_CONCURRENCY=10
BOCHA_API_KEY=
BOCHA_SEARCH_URL=https://api.bocha.cn/v1/web-search
BOCHA_FRESHNESS=noLimit
BOCHA_SUMMARY=true
```

如需强制使用 DuckDuckGo 搜索，可设置：

```env
WEB_SEARCH_PROVIDER=ddgs
```

如果不使用本地 Supabase，可在根目录 `.env` 中填写云端项目配置：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=postgresql://postgres.your-project:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
```

配置后，后端会使用云端 Supabase 项目，而不是默认的 `http://kong:8000`。


### 2. 启动服务

在项目根目录执行：

```bash
docker compose up --build
```

启动后访问：

- 前端：http://localhost:5180
- 后端健康检查：http://localhost:5000/health
- Supabase Studio / API Gateway：http://localhost:8000

Supabase Studio 登录账号和密码来自 `db/supabase/.env` 中的 `DASHBOARD_USERNAME` 和 `DASHBOARD_PASSWORD`。

本地 Supabase 配置已同步至当前官方 self-hosting Docker 版本。现有数据使用 PostgreSQL 15，因此根 Compose 叠加 `db/supabase/docker-compose.pg15.yml`，固定在官方 PG15 兼容镜像；不要直接把该数据目录挂载到 PostgreSQL 17 镜像。

### 3. 初始化 Supabase 表结构

首次启动 Supabase 并等待服务健康后，执行一次 schema 初始化：

```bash
docker compose --profile init run --rm scholarx-schema
```

该命令会应用 `db/schema.sql`，创建 ScholarX 所需的数据表、RLS 策略、索引和 Storage bucket。之后如果修改了 `db/schema.sql`，可以重新运行该命令。

### 4. 初始化 DBLP 与 CCF 数据

默认初始化流程会下载 DBLP，使用 `backend/scripts/insert_dblp.py` 解析导入，并导入项目内置的 CCF CSV：

```bash
docker compose run --rm backend python scripts/init_data.py
```

如果已经准备好 `dblp.xml` 和 `dblp.dtd`，可放在根目录的 `dblp` 文件夹下，并跳过下载：

```bash
docker compose run --rm backend python scripts/init_data.py --skip-download
```

只导入 CCF CSV：

```bash
docker compose run --rm backend python scripts/insert_venue.py /app/ccf_2022_with_dblp_key.csv
```

DBLP 数据量较大，导入过程会消耗较多时间和内存。

可选搜索性能优化：如果 DBLP 全量导入后标题模糊搜索较慢，可以在 Supabase Studio 的 SQL Editor 中额外创建 trigram 索引：


```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_title_trgm ON public.papers USING GIN (title gin_trgm_ops);
```

这个索引不是必须项。它会提升标题相似度或模糊匹配性能，但在大表上创建耗时较长，建议在 DBLP 全量导入完成后再执行。

定时 DBLP 更新：`scheduler` 服务可定期下载并导入 DBLP。默认时区为 `Asia/Shanghai`，可在根目录 `.env` 中启用：

```env
SCHEDULE_DBLP_ENABLED=true
SCHEDULE_DBLP_WEEKDAY=6
SCHEDULE_DBLP_HOUR=23
SCHEDULE_DBLP_MINUTE=30
SCHEDULE_DBLP_SKIP_CCF=true
```

上述配置表示每周日 23:30 执行。下载前脚本会比较 DBLP 官方 MD5 与上次成功运行保存的 `./dblp/dblp.xml.gz.md5`；如果 MD5 未变化，会跳过 DBLP 下载和导入。

### 5. 加载浏览器扩展

Chrome 或 Edge 可加载 `browser-extension` 目录中的扩展：

1. 先启动 ScholarX，默认扩展 API 地址为 `http://localhost:5000/api`。
2. 打开 `chrome://extensions`。
3. 启用开发者模式。
4. 点击“加载已解压的扩展程序”，选择项目中的 `browser-extension` 目录。
5. 打开 ScholarX 并选择一个论文库，或在扩展弹窗中选择论文库。

使用方式：

- 在 PDF 页面点击 ScholarX 扩展按钮，选择“保存 PDF”。
- 在 PDF 链接上右键，选择“保存链接 PDF 到 ScholarX”。

扩展会调用现有上传接口：

```text
POST /api/libraries/<library_id>/uploads/pdf?async=1
```
