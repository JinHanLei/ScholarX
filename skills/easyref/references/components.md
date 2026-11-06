# 界面与组件

## 项目与全局界面

顶部项目名称打开设置，`+` 创建项目；设置内可切换、导入/导出、保存 checkpoint
和备份。项目配置含研究问题、目标 venue、写作规则和实验解释器。Logo 打开翻译
API 设置。底部六阶段导航，Idea 执行进度蓝条跨阶段显示。
入口 `GET /api/projects`、`GET /api/projects/<pid>`、`GET /api/status`。
导入工程须先预览再确认独立副本，不直接改写源目录。

## Literature

本地关键词/高级检索、复合排序、自选/归档、PDF 上传/公开全文抓取、页内阅读、
摘录笔记和划词流式翻译。界面搜索只查数据库；联网在当前 Codex 对话完成。
检索不自动收藏；授权收藏时去重并写目标项目，验证 selected_total/in_library。
右上角启用划词翻译，密钥在 Logo 设置。该 API 翻译与 Paper 的 Codex 结构化
辅助是不同传输。精确查询/收藏流程读 `app/docs/LITERATURE_CODEX.md`。

## Idea

先读 `/api/idea-context`，再读该项目完整 document/revision。中心为论文模型图，
支持 SVG/可编辑 PPT 导出、PPTX 第一页导入、设计说明和讨论记录。
保留稳定 ID；讨论确定的修改通过 records API 原子保存完整设计和 decision
（修改、理由、预期验证），重试复用 UUID。不记录每句闲聊或应用开发改动。
草稿不执行；“保存为版本”固定设计并创建共享 Vn、排队运行。结论绑定真实版本/
Run，保留旧设计和失败记录。读 `app/docs/IDEA_CANVAS.md`、`IDEA_FIGURES.md`。
同包 CLI：`app/backend/scripts/idea_canvas.py --api-base <实例>/api context`。

## Experiment

结果表按数据集/评价协议分组，Baseline 与 Ours 版本独立选择。点击结果查看真实
配置、源码、日志和观察记录；手动登记保留旧实验能力。
`GET /api/projects/<pid>/experiment-results`；run 的 `/report` 映射已存在指标，
`/notes` 追加真实参数/指标快照；这些接口不启动运行。
`GET /api/projects/<pid>/experiments/<run_id>/tracking` 查 MLflow 曲线/资源。
训练调用 `easyref_tracking.log_metrics(..., step=...)`；最终评价写
`EASYREF_METRICS_PATH`。历史同步不能补造曲线或追溯绑定新 Idea 版本。
保留项目指定解释器、数据、协议和种子。读 `app/docs/EXPERIMENT_RESULTS.md`、
`app/docs/EXPERIMENT_TRACKING.md`。

## Paper

LaTeX 正文与底部横向段落大纲同步。源码阅读模式启用划词修改，同段内选区输入
要求、预览、采纳；暂不支持 PDF 文本/跨段选区。保留锚点和锁定大纲，写入用 hash。
空稿用真实相似工作元数据/摘要生成逐段计划，确认后生成正文并存新 `.tex`，不覆盖
旧文件。缺证据标 TODO。`/api/projects/<pid>/paper/assist` 的 kind 为 plan/draft/
revise，轮询 `.../assist/<sid>`，采纳 `POST .../assist/<sid>/apply`。
字段见 `app/backend/app/local_paper_assist.py`；限制见 `app/docs/PAPER_HANDOFF.md`。

## Polish 与 Review

Polish 是投稿前对抗审查，Review 是回复真实审稿人，历史/进度独立。
`POST /api/projects/<pid>/reviews` 对抗审查必须显式 `mode:"adversarial"`，附
roles/instructions/selected/max_rounds/max_seconds；默认模式已改为 rebuttal。
回复传 `{mode:"rebuttal",source,language,instructions}`，language 为 English 或
中文。会读取项目并执行可行本地修改/检查，只在用户请求此处理时调用。
`GET /api/reviews/<id>` 轮询；完成后 PATCH `.../responses` 用 revision 和
`responses:[{id,response}]` 保存编辑。支持停止、历史和 Markdown 导出。
回复是草稿，不自动标为验证/解决，不自动投稿。
详见 `app/docs/REVIEW_REBUTTAL_HANDOFF.md`。

## Profile 当前范围

个人中心仍属于旧版 `VITE_EASYREF_LEGACY=true` 界面，本轮分支无新增提交。
标准本地工作台没有个人中心导航，不声称已接入本地账户、Token 统计、徽章和
年度报告。需要这些功能时另行实现验证，不擅自切换 Supabase 或展示虚构统计。
