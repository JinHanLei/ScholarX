# EasyRef

全开源的Vibe Schloar平台。既然不懂代码可以Vibe Coding，那么不懂论文也可以Vibe Researching。

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
        - PDF批量上传：支持单个、多个PDF以及ZIP等格式上传，自动解析-关联论文。后端解析文件并将PDF存入Supabase Storage的 `easyref-pdfs` bucket。
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

Supabase Studio 登录账号和密码来自 `supabase/er_supabase/.env` 中的 `DASHBOARD_USERNAME` 和 `DASHBOARD_PASSWORD`。

### 3. 初始化 Supabase 表结构

首次启动 Supabase 并等待服务健康后，执行一次 schema 初始化：

```bash
docker compose --profile init run --rm easyref-schema
```

该命令会应用 `supabase/schema.sql`，创建 EasyRef 所需的数据表、RLS 策略、索引和 Storage bucket。之后如果修改了 `supabase/schema.sql`，可以重新运行该命令。

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

也可以通过后端接口触发同样的数据流程：

- `POST /api/admin/data-init`
- `POST /api/admin/dblp-update`

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

1. 先启动 EasyRef，默认扩展 API 地址为 `http://localhost:5000/api`。
2. 打开 `chrome://extensions`。
3. 启用开发者模式。
4. 点击“加载已解压的扩展程序”，选择项目中的 `browser-extension` 目录。
5. 打开 EasyRef 并选择一个论文库，或在扩展弹窗中选择论文库。

使用方式：

- 在 PDF 页面点击 EasyRef 扩展按钮，选择“保存 PDF”。
- 在 PDF 链接上右键，选择“保存链接 PDF 到 EasyRef”。

扩展会调用现有上传接口：

```text
POST /api/libraries/<library_id>/uploads/pdf?async=1
```
