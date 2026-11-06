# 在 Codex 对话中检索和收藏文献

高级检索中的“你也可以通过聊天来检索”指当前 Codex 对话。EasyRef 不为此再创建聊天栏；Codex 通过本地 HTTP API 查询和收藏，页面重新获得焦点或重新显示时刷新自选。

## 实例与项目

Literature 开发实例为 `http://127.0.0.1:5011/api`，使用该 worktree 独立的项目和数据。主实例通常为 `http://127.0.0.1:5000/api`。只向用户正在使用且授权操作的实例写入；不能因查询主库而把自选写到主实例。使用 `GET /projects` 获取项目 ID，根据当前项目名称或目录匹配目标；有多个可能目标时先明确项目，不能任取第一项。

## 数据库检索和加入自选

1. `GET /literature/search?q=graph&rank=A&year_from=2023&limit=30&offset=0`。可选过滤参数包括 `author`、`venue_name`、`type`、`year_to`；`type` 为 `Conference` 或 `Journal`。
2. 当前实例的结果在 `papers`，可选外部主库结果在 `catalog.papers`。外部主库通过已有本机服务只读查询，不共用 SQLite 文件。
3. 当前实例结果：`POST /papers/<id>/library`，JSON 为 `{"project_id":"目标项目 ID"}`。
4. 外部主库结果：`POST /projects/<project_id>/literature/catalog/collect`，JSON 为 `{"catalog_id":"检索结果中的 catalog_id"}`。必须先查询取得候选；服务重启或候选过期后重新查询。该操作只写当前实例。

用户只要求检索时先呈现结果；用户要求加入自选或授权检索并收藏时再执行收藏。

## Codex 网络检索结果

在当前 Codex 对话中检索网络并核对论文来源。收藏前先用标题查询 EasyRef，优先使用已存在的条目；没有条目时，通过 `POST /papers` 创建个人文献，再使用返回的 `id` 调用上述收藏接口。

`POST /papers` 接收 `title`、`authors`（字符串数组）、`year`、`venue_name`、`doi`、`url` 等文献字段。仅填写核实的信息，缺失 DOI 留空，URL 使用实际论文来源页面，不编造等级。需要匹配等级时先用 `GET /venues` 查找真实期刊或会议记录，并传入匹配的 `venue_id`。同 DOI/DBLP key 会复用已有条目；无 DOI 时先查标题、年份及来源链接以避免重复。

收藏后用 `GET /papers?project_id=<project_id>&source=all&archived=0` 验证论文已在目标项目的自选中。不得直接修改 SQLite、复制主库或操作其他工作区的数据目录。以上流程使用现有接口，不需要启动应用内 Codex 聊天或创建应用内聊天记录。
