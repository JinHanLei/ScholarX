# Experiment 结果表与运行记录

Experiment 开发实例为 `http://127.0.0.1:5013`，数据独立于 Idea 的 5012。
用标准项目导出/导入创建开发副本，不共享数据库或研究目录。

页面主体为数据集、Baseline、Ours 与指标组成的结果表。Ours 下拉框读取真实
Idea 版本；只切换显示，不创建版本或启动实验。正式执行仍由 Idea 中的
“保存为版本”触发。历史未关联运行单独显示，不追认到某个 Vn。

同一数据集、划分、评估协议和评估范围才共用一张表；不同 seed 保留独立行，
不自动挑最好结果或求均值。只有完成运行中的有限数值进入结果表，缺失值显示
破折号，零值正常保留。系统测试数据默认隐藏。点击方法或数值可以查看参数、
原始指标、命令、日志、产物和实验记录。旧 Blueprint 与手动登记入口保留在
“手动登记”弹窗内。

运行详情现已接入 MLflow 本地训练曲线和资源监控，见
[实验监控说明](EXPERIMENT_TRACKING.md)。

## Codex 直接读取与整理

先读取 `GET /api/projects` 确认项目，再读取：

```text
GET /api/projects/<project_id>/experiment-results
```

返回 `runs`（原始运行和历史记录）、`rows`（结果表行）、`versions`（真实版本）
及 `workflow` 接口指引。结合项目协议确认方法身份、指标定义和越大/越小越好。
不要凭指标名称猜测 Baseline，也不要补造数据。

整理已有指标：

```text
POST /api/projects/<project_id>/experiments/<run_id>/report
```

```json
{
  "id": "<stable UUID>",
  "expected_revision": null,
  "mapping": {
    "reason": "依据本次评估协议，整理已有指标为对照表。",
    "rows": [{
      "method": "Raw retrieval",
      "role": "baseline",
      "scope": "test",
      "metrics": [{
        "source": "test_raw_ic",
        "label": "IC",
        "unit": "",
        "direction": "higher"
      }]
    }]
  }
}
```

`expected_revision` 首次为 null，之后传 `runs[].mapping_revision`。
`role` 为 `baseline`、`ours` 或 `unclassified`；`direction` 为 `higher`、
`lower` 或空字符串。每个 source 必须已存在于运行的 metrics 中。数值始终从
该运行读取，提交的数值不采用；数据集、参数和版本关联不能由这个接口改写。
一个运行可含多个对照方法。所有整理都追加历史，不覆盖旧记录。

讨论确定实验观察后追加：

```text
POST /api/projects/<project_id>/experiments/<run_id>/notes
```

```json
{"id": "<stable UUID>", "text": "本次参数选择、观察、结论和下一步验证。"}
```

服务端自动附上当时真实的状态、参数、指标及版本关联。重试时复用 UUID 和
原请求，保证幂等；同一 ID 不允许变更内容。Idea 研究记录中明确引用此运行的
结论也显示在实验详情中。结果整理与记录不会启动实验。

## 集成与验证

- 本分支基于 Idea 的 `b7e52d2`，复用正式版本和执行流程。
- 新增迁移 `008_experiment_result_records.sql`，已有迁移不改。
- 共享接线涉及 `local_api.py`、`research_schema/bridge.py`、
  `ResearchWorkbench.jsx` 和跨页面测试；结果记录随研究项目导出/恢复。
- 结果表本身没有新增依赖；后续 MLflow 接入依赖见实验监控说明。模块代码和样式在 `research/experiment/` 与
  `backend/app/local_experiment_results.py`。
- 后端覆盖来源校验、并发修订、幂等、真实版本、快照与导出恢复；前端覆盖
  版本筛选、协议隔离、零值、多 seed、记录持久化和窄屏。

浏览器测试先在单独终端启动临时数据服务（关闭即释放临时目录）：

```powershell
.\.venv\Scripts\python.exe backend/scripts/serve_experiment_ui_test.py --port 5019
```

另一个终端运行：

```powershell
$env:EASYREF_TEST_URL = 'http://127.0.0.1:5019'
$env:EASYREF_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm --prefix frontend run test:e2e -- tests/experiment-results.spec.js tests/idea.spec.js tests/workbench.spec.js
```

每个结果表测试创建独立合成项目；fixture 接口仅存在于这个临时服务中。
普通应用实例没有 fixture 接口，相应测试会跳过，不向用户项目写测试数据。
