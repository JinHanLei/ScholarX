# Idea 模型画布与统一版本

Idea 页面以紧凑模型预览为中心，不包含聊天面板。讨论在 Codex 聊天中进行，
模型通过本地 API 更新；页面自动轮询最新状态。点击模块查看详情，点击“编辑模型”
打开 React Flow 编辑窗口，调整模块和连线；“完成编辑”返回预览并保存草稿。
连续编辑停下约两秒后自动保存草稿。改结构、说明、拖动、排版或切换页面均不启动实验。
设计完成后点击“保存为版本”，才固定当前设计、创建统一版本并自动进入实验流程。
这一操作会包含尚未自动保存的最后一次修改，无需再去 Experiment 点击“开始”。
支持撤销、重做；未保存的本地修改在当前浏览器标签页中保留，切换工作区后可恢复。
并发编辑冲突不会覆盖远端版本，可先下载本地副本再重新加载。

预览按窗口宽度自动排列简单链路，窄窗口会折行；复杂分支和循环用 Dagre 排列，
超出区域可滚动查看。预览布局不写回模型，编辑窗口和 PPT 仍使用保存的节点位置。
设计说明默认显示原文节选，可展开全文；版本列表默认显示最近三条，可展开全部。
这些阅读操作不会修改草稿修订、创建版本或启动实验。

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
但不创建新的实验版本。Codex 修改模型默认只用 `save` 保存草稿，等待用户点击按钮。
只有用户明确要求提交版本时才使用 `publish`（参数与 `save` 相同）或版本提交接口。

对应 HTTP 接口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/idea-context` | 当前页面项目/Idea 与实例地址 |
| `GET/POST /api/projects/<pid>/ideas` | 列表、创建或接入已有 Idea |
| `GET/PUT /api/projects/<pid>/ideas/<id>` | 读取/乐观锁保存草稿；不排队 |
| `POST /api/projects/<pid>/ideas/<id>/versions` | 提交完整 document 与 expected_revision，保存正式版本并排队 |
| `GET /api/projects/<pid>/idea-versions` | 版本、真实阶段、变更摘要、运行与事件 |
| `POST /api/idea-versions/<id>/cancel` | 停止版本，保留历史 |
| `POST /api/idea-versions/<id>/retry` | 同一版本追加重试，不改旧运行 |

不要通过通用组件写入接口或直接编辑 SQLite/研究导出绕过版本管理。
已有 Idea 可接入画布，原字段和已有 Blueprint 历史保留；通用旧实验界面仍可访问。
接入已有架构会创建“历史设计”版本，不重新启动历史实验，也不事后改写旧 Run 的设计关联。
用户点击“保存为版本”后才创建并执行下一版本。旧 Blueprint 的 `source_ids` 关系也可用于恢复架构。

## 导出与验证

PPT 通过 PptxGenJS 延迟加载生成。模块、文本和箭头为原生可编辑对象，设计说明
放在后续幻灯片与备注中。导出是单向的，不支持外部 PPT 修改自动回传，也不承诺
任意 HTML/LaTeX 内容与 PowerPoint 的完全一致渲染。

项目标准导出包含统一版本、事件和运行关联；完整实现归档随实验产物保存。
修改后的代码如与原实现清单不符，会阻止继续把它当成原版本执行。

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_idea_canvas.py -q
node --test frontend/unit/idea-graph.test.mjs
npm --prefix frontend run build
# 使用隔离数据、IDEA_AUTOSTART=False 的验收服务，避免 UI 测试调用真实 Codex。
# EASYREF_TEST_URL 指向该实例；EASYREF_BROWSER_EXECUTABLE 可指定本机 Chrome。
npm --prefix frontend run test:e2e -- tests/idea.spec.js
```

共享接线文件：`local_api.py`、`local_codex.py`、`local_store.py`、
`research_schema/bridge.py`、`ResearchWorkbench.jsx`、`ExperimentWorkspace.jsx`，
以及依赖清单。新增迁移编号为 `006_idea_versions.sql`，集成其他组件前需检查编号冲突。
