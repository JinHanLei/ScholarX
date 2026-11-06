# Idea 研究记录与统一版本

Idea 是随 Codex 聊天更新的研究档案。页面中心展示论文模型图，下面是设计说明、
讨论决策和对应实验结果；没有内嵌聊天或拖拽编辑器。

Codex 通过本地 API 直接读取当前项目。每次讨论确定一项研究修改时，一次性提交
完整设计、论文图和研究记录（修改内容、理由、预期验证）。不要保存每轮闲聊，
也不要把应用开发工作写成研究决策。记录保存为草稿，不创建实验版本、不启动执行。

设计完成后由用户点击“保存为版本”，才固定当前设计、创建 Idea/Experiment 共用的
Vn 并开始实验。此操作包含尚未自动保存的最后一次说明修改；之前的草稿决策归入该
版本，但各决策自己的设计快照保持原样。仅图形外观调整不触发新的实验。

实验指标由对应 Run 记录直接显示。Codex 在后续讨论中追加结论，引用准确的版本 ID
和运行 ID；指标从服务端实际运行记录读取，不采用提交内容里自报的数字。结论可以
针对旧版本补写，此时固定旧版本的设计，不覆盖当前的新草稿。

论文图以结构化矢量元素保存，可导出 SVG 和原生可编辑 PPT。旧版本如果没有论文图，
保留原方案与实验记录，不伪造或回填历史图。修改结构却沿用旧图时会显示待同步状态，
并阻止提交不一致的版本。详见 [论文图格式](IDEA_FIGURES.md)。

并发冲突不会覆盖远端设计，未保存的本地说明可下载后重新加载。浏览、导出和展开
历史记录不会修改设计或开始实验。

## 版本与执行

- 版本号在研究项目内递增；Idea、Blueprint 和 Experiment 使用同一个 `Vn`。
- 一个版本可以包含多个 seed/消融运行；重试保留版本号，并追加新的运行记录。
- 图与设计说明在版本创建时固定。后续外观调整保存在当前画布，不改写历史版本图。
- 每个版本/重试使用独立源码目录 `.easyref/idea-versions/vN/<attempt>/src/`。
  复制项目中 Git 跟踪或未忽略的文件，排除依赖、缓存、凭据、研究导出和已有产物。
  超过 200 MB 会明确停下；被 Git 忽略的数据集不会自动复制，应在设计中明确数据输入。
- Codex 在版本目录中更新实现，不直接修改原工程或其他版本；新版本以当前项目源码
  为起点，根据完整设计实现。项目中的解释器设置继续生效。
- 执行器检查入口、Python 语法、运行参数及源码清单，归档完整实现 ZIP 与 SHA256，
  然后自动调用已有实验执行器。源码/配置与真实指标均绑定该版本。
  实验通过 `EASYREF_CONFIG` 读取运行配置，通过 `EASYREF_METRICS_PATH` 输出真实指标；
  两者由执行器提供绝对路径，位于源码快照之外。实验期间不能改写源码文件。
- 同一项目按版本顺序执行。较新设计不会覆盖正在运行的代码。不同项目可独立执行。
- 缺少数据、依赖或科学定义时显示具体阻塞原因，不自动编造实验，也不自动安装依赖、
  租用算力或伪造指标。Codex 原生授权请求仍保留；底部显示等待状态。
- 服务重启会将进行中的版本标记为中断，保留日志与阶段。未开始的队列可继续；
  中断/失败版本可重试。导入项目不会自动恢复原机器的进程。

底部蓝条显示实际阶段：设计排队 → 固定源码 → 更新实现 → 校验 → 运行 → 汇总。
展开可查看事件、停止当前版本或重试失败版本。Experiment 可查看同版本的模型、
运行日志、配置、源码归档和指标。选择历史图可回看，也可基于旧版继续编辑草稿，
确认后再保存为新版本。同一设计重复提交不会重复排队；仅外观变化不会开启新的实验。

## 从当前 Codex 聊天操作模型

使用当前实例的 API 地址。Idea 开发实例为 `http://127.0.0.1:5012/api`，主实例为
`http://127.0.0.1:5000/api`；不能把不同实例的项目 ID 混用。页面自动维护当前项目和
模型上下文，Codex 直接通过 `GET /api/idea-context` 或下面的 `context` 命令读取，
无需用户复制、粘贴项目 ID 或模型内容。返回值包含项目、当前模型完整草稿和修订号。
先读取，确认项目，再修改：

```powershell
python backend/scripts/idea_canvas.py --api-base http://127.0.0.1:5012/api context
python backend/scripts/idea_canvas.py --api-base http://127.0.0.1:5012/api create --project <PROJECT_ID> --name "研究模型"
python backend/scripts/idea_canvas.py --api-base http://127.0.0.1:5012/api get --project <PROJECT_ID> --idea <IDEA_ID>
python backend/scripts/idea_canvas.py --api-base http://127.0.0.1:5012/api save --project <PROJECT_ID> --idea <IDEA_ID> --expected-revision 0 --file model.json --reason "新增检索分支"
python backend/scripts/idea_canvas.py --api-base http://127.0.0.1:5012/api versions --project <PROJECT_ID>
```

`model.json` 是完整设计，不含 API 密钥，不是应用源码：

```json
{
  "name": "研究模型",
  "description": "研究问题、假设、模块职责、真实数据来源、训练和评价方案。",
  "graph": {
    "nodes": [
      {"id": "input", "kind": "input", "label": "输入", "description": "输入数据定义", "inputs": "", "outputs": "B × T × D", "parameters": "", "position": {"x": 0, "y": 100}},
      {"id": "encoder", "kind": "backbone", "label": "编码器", "description": "待确定的实现应在此明确标记", "inputs": "B × T × D", "outputs": "B × H", "parameters": "", "position": {"x": 320, "y": 100}}
    ],
    "edges": [{"id": "input-to-encoder", "source": "input", "target": "encoder", "label": "features"}]
  }
}
```

节点类型：`input / backbone / module / output / loss`。更新时保留未改模块的 ID、
位置与用户标注，优先局部修改。`expected_revision` 必须来自最新读取；冲突时重新读取
并协调，不能直接覆盖。当前画布修订与研究版本号是不同字段：草稿保存增加修订，
但不创建新的实验版本。探索中的编辑用 `save` 保存草稿；讨论确定修改后用 `record`
原子保存设计与决策。两者都等待用户点击按钮才开始实验。
只有用户明确要求提交版本时才使用 `publish`（参数与 `save` 相同）或版本提交接口。

对应 HTTP 接口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/idea-context` | 当前页面项目/Idea 与实例地址 |
| `GET/POST /api/projects/<pid>/ideas` | 列表、创建或接入已有 Idea |
| `GET/PUT /api/projects/<pid>/ideas/<id>` | 读取/乐观锁保存草稿；不排队 |
| `GET/POST /api/projects/<pid>/ideas/<id>/records` | 查询研究记录 / 原子保存设计与一条确定的决策或结论 |
| `GET /api/projects/<pid>/ideas/<id>/records/<record_id>` | 读取这条记录当时的完整设计快照 |
| `POST /api/projects/<pid>/ideas/<id>/versions` | 提交完整 document 与 expected_revision，保存正式版本并排队 |
| `GET /api/projects/<pid>/idea-versions` | 版本、真实阶段、变更摘要、运行与事件 |
| `POST /api/idea-versions/<id>/cancel` | 停止版本，保留历史 |
| `POST /api/idea-versions/<id>/retry` | 同一版本追加重试，不改旧运行 |

不要通过通用组件写入接口或直接编辑 SQLite/研究导出绕过版本管理。
已有 Idea 可接入画布，原字段和已有 Blueprint 历史保留；通用旧实验界面仍可访问。
接入已有架构会创建“历史设计”版本，不重新启动历史实验，也不事后改写旧 Run 的设计关联。
用户点击“保存为版本”后才创建并执行下一版本。旧 Blueprint 的 `source_ids` 关系也可用于恢复架构。

## 聊天中的记录操作

先 `context`，再读取当前文档和修订。将完整文档写入临时 JSON，另写一份记录 JSON：

```json
{
  "id": "一枚新 UUID；重试时复用",
  "kind": "decision",
  "title": "确定的修改标题",
  "change": "这次具体修改了什么",
  "reason": "讨论中确定的理由",
  "validation": "预期怎样验证；不涉及实验时明确说明",
  "source": "Codex · 当前讨论"
}
```

```powershell
python backend/scripts/idea_canvas.py --api-base http://127.0.0.1:5012/api record --project <pid> --idea <id> --file <document.json> --record-file <record.json> --expected-revision <revision> --reason "确定的修改"
```

记录结论时用 `kind: "conclusion"`，必填 `version_id` 和 `conclusion`，可填写
`experiment_ids: ["实际 Run ID"]`。仍提交当前完整文档，但不要同时改当前模型；
服务端将该记录的设计快照固定为被引用的正式版本。若还需要调整模型，另记决策。

相同记录 ID 和相同请求内容的重试不会重复记录或增加修订；同一个 ID 不能改写内容。
更正历史结论应追加记录，而非覆盖原记录。研究记录随项目 checkpoint 导出与恢复。
CLI 默认等待 120 秒，包含项目归档时间，可用全局参数 `--timeout` 调整。超时后先用
`get` / `records` 确认是否已写入，不能换一个记录 ID 盲目重复提交。

## 导出与验证

原生论文图通过 PptxGenJS 导出，模块、文本和箭头为可编辑对象，设计说明放在后续
幻灯片与备注中。工具栏支持“导入 PPT”：选择不超过 25 MB 的 `.pptx`，默认取展示
顺序中的第一张（不假定文件名是 slide1.xml），保存为草稿并追加一条导入记录，不启动实验。
旧 `.ppt` 需先在 PowerPoint 中另存为 `.pptx`。

导入后保留完整原文件；“导出 PPT”下载该文件，可在 PowerPoint 编辑后再次导入。
旧记录和版本继续引用各自的不可变文件，不会被新导入覆盖。导入图不能导出 SVG；
导入不会自动把 PPT 内容解析成原有模块图，执行器须读取第一张及其提取文字，协调
原模块定义；若模型含义不明确则阻塞，不能直接沿用旧图执行。

文件位于项目 `research-assets/idea-ppt/<idea_id>/<sha256>.pptx`，随标准项目导出。
接口 `POST /api/projects/<pid>/ideas/<id>/pptx` 接收 multipart 的 `file`、完整 `document`
JSON、`expected_revision` 和 `record_id` UUID；`GET .../pptx/<sha256>` 获取原文件。
读取验证内容哈希，外部改写原文件会明确报错。

预览按需加载 [pptx-renderer 1.4.0](https://github.com/aiden0z/pptx-renderer)，禁用外部
媒体加载和可选 PDF/EMF 预览回退。为避免升级全局 PDF 阅读器，package.json 仅对它的
未使用的可选 pdfjs peer 使用现有版本 override。普通文字、形状、图片、表格等可预览，
特殊字体、动画及复杂 Office 效果不保证与 PowerPoint 完全一致；原文件始终保留。

项目标准导出包含统一版本、事件和运行关联；完整实现归档随实验产物保存。
修改后的代码如与原实现清单不符，会阻止继续把它当成原版本执行。

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_idea_canvas.py backend/tests/test_idea_research.py backend/tests/test_idea_pptx.py -q
node --test frontend/unit/idea-graph.test.mjs
npm --prefix frontend run build
# 使用隔离数据、IDEA_AUTOSTART=False 的验收服务，避免 UI 测试调用真实 Codex。
# EASYREF_TEST_URL 指向该实例；EASYREF_BROWSER_EXECUTABLE 可指定本机 Chrome。
npm --prefix frontend run test:e2e -- tests/idea.spec.js tests/idea-pptx.spec.js
```

共享接线文件：`local_api.py`、`local_codex.py`、`local_store.py`、
`research_schema/bridge.py`、`ResearchWorkbench.jsx`、`ExperimentWorkspace.jsx`，
以及依赖清单。统一版本使用 `006_idea_versions.sql`；研究记录新增
`007_idea_research_records.sql`，并在 `research_schema/bridge.py` 接入项目导出与恢复。
聊天记录约定写入 `AGENTS.md`。共享修改单独提交，集成其他组件前需检查迁移编号冲突。
