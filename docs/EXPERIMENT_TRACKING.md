# MLflow 实验监控

Experiment 中的运行详情现在包含训练曲线、资源监控和 MLflow 关联。
主结果表继续读取 EasyRef 已完成运行的最终指标。保存 Idea 正式版本后启动执行，
单纯查看、切换版本、同步旧记录不会执行训练。

## 安装与启动

在所属组件 worktree 内运行原启动脚本即可安装依赖：

```powershell
.\scripts\start-component.ps1 -Component experiment
```

本地使用 `mlflow-skinny==3.18.0` 与 SQLAlchemy/Alembic/SQLParse，数据保存在
当前组件 `.easyref/mlflow/tracking.db`，实验附件在同目录的 artifacts 中。
不需要 Docker、云账户或额外监听端口；UI 通过 EasyRef API 读取 MLflow SDK。
这次接入的是 MLflow 追踪引擎，页面使用 Recharts 3.10.1 展示交互曲线。
GPU 通过 `nvidia-ml-py` / NVIDIA NVML 读取，进程资源使用 psutil。

每个组件实例有独立监控库和 store ID，不共享数据库。环境中的外部
MLFLOW_TRACKING_URI 不会改变这个本地适配器的目标。当前实现覆盖 EasyRef
本地脚本执行器；尚未提供远程 SSH 采集代理或多服务器调度。

## 训练脚本

执行器给 Python 脚本注入标准库实现的 helper，无须给训练解释器安装 MLflow：

```python
from easyref_tracking import log_metrics

# 在已有训练/验证循环中使用真实计算的数值。
log_metrics({"train/loss": train_loss, "validation/loss": validation_loss}, step=epoch)
```

缺少验证指标时省略该键，不创建占位数值。所有数值必须有限，step 为非负整数。
`system/` 和 `final/` 为保留前缀。脱离 EasyRef 运行时，如果没有
EASYREF_TRACKING_DIR，helper 返回 False，不强迫启动追踪服务。

每个进程写独立的 `training-<pid>.jsonl`，防止多进程覆盖。同一曲线内不同
rank 的数值不会自动合并；需要分别比较时，在指标名称中包含 rank。
Node / R 也可以向 EASYREF_TRACKING_DIR 写相同格式的 UTF-8 JSONL：

```json
{"metrics":{"train/loss":0.3},"step":12,"timestamp":1793980800000}
```

上面只是格式示例。每行 timestamp 是采样时的 Unix 毫秒，末尾必须换行。
日志路径在项目内的 `.easyref/runs/<run_id>/events/`，由执行器提供。

最终评估结果仍写入 EASYREF_METRICS_PATH，使用原有有限数值 JSON 协议。
执行器确认脚本成功、新指标文件有效后，主表才采用这些值；同时在 MLflow
记录 `final/<metric>`。训练/验证曲线不直接覆盖主表。

Idea 的实现提示已加入采集约定，并要求返回真实重要超参数。旧脚本不会被自动
改写；它们仍可采集资源和最终结果，训练曲线需要加入上述上报调用。

## 采集与数据关系

- 一次 EasyRef 执行对应一个 MLflow Run。同一个 Idea Vn 可含多个运行。
- 保存 `easyref.run_id`、project ID、实际 Idea version UUID、版本显示名和
  Git commit，关联来自 idea_version_runs，而不是从名称猜测。
- 参数从注册配置读取；完整配置、最终结果和日志作为附件保存。
- 大约每 2 秒采集主进程 CPU、进程树内存、主机内存，以及可用 NVIDIA GPU
  的整卡利用率和显存。整卡数据可能包含其他任务；无 NVML / GPU 时显示缺失
  和采集说明，不写入伪造的零值。
- 运行结束、失败、取消分别结束对应追踪；重启后已中断的记录标记为 FAILED，
  不自动恢复执行。重试仍需要新的 EasyRef Run。
- 图表使用真实采样点，最多显示 400 点并保留分桶极值、首尾点；完整历史仍在
  MLflow 和本地日志中。

## Codex API

```text
GET  /api/experiment-tracking/status
GET  /api/projects/<pid>/experiments/<run_id>/tracking
GET  /api/projects/<pid>/experiments/<run_id>/tracking?metric=train%2Floss
POST /api/projects/<pid>/experiments/<run_id>/tracking/sync
```

GET 返回运行状态、MLflow ID、最近同步时间、错误、实际指标目录和曲线点。
可重复 metric 参数，每次最多选 8 条曲线。每条包含原始点数 total 和展示点
points；step、timestamp、value 都来自真实记录。

POST sync 只接受已结束运行。首次可同步旧运行的参数和已有最终结果；不会
补造历史训练过程或资源数据。对采集故障后留存的日志，可再次同步恢复曲线。
同步原有记录不会修改其配置、指标或版本关联。若原指标经过带理由的校正，
再次同步会向 MLflow 追加更新值，主表始终以 EasyRef 的校正记录为准。

## 故障与导出恢复

追踪故障不会改变训练的成功/失败状态。原始 JSONL 留在运行目录，监控错误独立
显示，可在运行结束后重新同步。读取未写完的末行会等待下一轮；无效指标不会
作为数据采用。终止时读完剩余记录，避免短任务或密集上报丢失尾部采样。

迁移 009 新增 experiment_tracking 投影，记录本地 MLflow 关联与同步游标。
监控 JSONL 登记为 telemetry 实验产物，通过现有标准研究项目导出/恢复携带。
导入另一实例后先显示归档状态，显式同步时重建目标监控库中的 Run，保留
EasyRef Run / Idea 身份。不会把源实例的 MLflow ID 当成目标实例的活动进程。

## 集成交接与测试

共享改动：local_api.py 的 API 注册、research_schema/bridge.py 的导出恢复表、
local_ideas.py 的实现提示、迁移 009、Python 依赖、前端 package/lock、AGENTS。
模块实现：local_tracking.py、local_experiments.py、tracking/easyref_tracking.py、
experiment/RunMonitor.jsx 与 monitor.css。已有迁移不变。

测试服务器使用 docs/EXPERIMENT_RESULTS.md 的隔离启动方式，额外提供仅测试
服务可用的 /api/testing/experiment-tracking-fixture。它实际运行小型 CPU 标量
优化，明确标注 TEST DATA，不修改用户研究。相关检查：

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_experiment_tracking.py backend/tests/test_experiment_results.py backend/tests/test_local_workbench.py backend/tests/test_research_schema.py -q
npm --prefix frontend run build
npm --prefix frontend run test:e2e -- tests/experiment-tracking.spec.js tests/experiment-results.spec.js tests/idea.spec.js
```

接口依据：[MLflow Client](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.client.html)、
[SQLite 后端](https://mlflow.org/docs/latest/tracking/backend-stores/)、
[Skinny 安装说明](https://github.com/mlflow/mlflow/blob/master/libs/skinny/README_SKINNY.md)。
