# 2026-11-07 全组件集成与 EasyRef Skill

集成位置：主 `easyref` worktree，分支 `main`。起点 `c0b3ad7`。
所有组件工作区开始时干净；只在主目录合并，没有修改其他 worktree 的文件、HEAD
或暂存区，没有重启它们的服务，也没有复制用户数据库。

## 来源与顺序

| 分支 | 纳入的 tip | 合并提交 |
| --- | --- | --- |
| codex/literature | 8ecda6e | 47ed0da |
| codex/idea | b7e52d2 | 37e09bc |
| codex/experiment | 19dd607 | b1fde66 |
| codex/paper | 85623a5 | 9c30917 |
| codex/review | e031b64 | e3475c7 |
| codex/profile | c0b3ad7 | 已在基线，无新增提交 |

Experiment 已包含 Idea 祖先。六个 tip 均确认是集成 HEAD 的祖先。
组件目录仍停在各自分支，下一轮由对应任务在空闲时同步 main。

## 共享文件与冲突处理

- `backend/app/local_codex.py` 合并 web_search 与独立版本 workspace 参数，
  同时保留恢复会话配置和上下文。新增组合回归用例。
- `frontend/src/components/research/ResearchWorkbench.jsx` 保留 Logo API 配置、
  Idea/Experiment 版本跳转和进度条、切换前草稿刷新、Polish/Review 独立阶段/进度。
- `backend/app/local_library.py` 保留 Literature 已拆出的 assist/translation/catalog
  注册，Paper 使用新增 `local_text_assist.py`；不恢复旧内嵌路由覆盖新行为。
- `frontend/src/components/research/useLiteratureAssist.js` 使用兼容 Literature 默认
  resource 的通用轮询版本，去除自动合并带来的重复 generation/reset 声明。
- 其余共享接线：`backend/app/local_api.py`、`local_store.py`、
  `research_schema/bridge.py`、`frontend/src/components/PdfViewer.jsx`、`AGENTS.md`、
  README、前端 package/lockfile、后端 requirements、现有共享浏览器测试。
- 集成修复提交 `02b41bc` 更新内置 skill 的 Idea/Experiment 和两种 Review 合约，
  修复 `backend/scripts/smoke_codex.py` 的旧默认模式调用，更新 Paper 测试桩参数。
- 新增共享开发工具 `scripts/package_skill.py`，skill 源码在 `skills/easyref/`；
  `.gitignore` 排除本地 `releases/`。没有改全局 Git 配置或 hooks。

## 迁移与依赖

新增迁移 006 Idea versions、007 research records、008 result records、009 tracking。
每个源分支的每个 migration 与集成文件逐一比较 Git blob，全部字节相同，无撞号。

前端新增 PPTX renderer、Dagre、XYFlow、PptxGenJS、Recharts 及原分支 overrides；
后端新增 mlflow-skinny 3.18.0、SQLAlchemy、Alembic、sqlparse、psutil、nvidia-ml-py。
合并后未额外变更依赖声明或 lockfile。主前端原服务锁住 rolldown 原生文件，npm ci
遇到 EPERM；随后非删除式 npm install 成功，lockfile 不变，原服务未被终止。

## 验证

- 后端全套初跑：174 passed、1 failed；失败为 Paper fake Codex 不接受 Literature
  新 web_search 参数。修正后 Paper + Codex 配置 9 项全部通过，包括新增组合用例。
  累计覆盖当前 176 个不同后端用例，无剩余已知失败；未再次整套运行。
- 前端 production build 通过；3 个 unit 文件共 10 项通过。
- 隔离 fixture 服务 5019：现有 18 项 Playwright 全部通过，包含真实 MLflow 采集、
  结果表、Idea 决策/版本/PPTX、Paper、Review、项目导入导出和窄屏。
- 解压后的 skill 使用自己的全新 venv 和独立数据在 5021 启动，追加 Paper、Review、
  全局工作台 5 项浏览器测试全部通过。测试数据仅在 releases/validation 下。
- 包内 SHA256 与文件逐一验证；排除数据库/凭据/依赖/缓存。首次验证包约 7.7 MiB。
- skill-creator quick_validate 通过（Windows 用 `python -X utf8`）。重复启动复用
  原 PID；第二个数据目录锁、占用端口启动、覆盖已有 skill 均正确拒绝。

## Skill 与范围

发行包包含后端、构建界面、CCF 注册表、原样迁移、科研 skill、追踪助手及组件
操作指南；维护代码与安装包分开。`python scripts/package_skill.py --install`
安装到 Codex 用户 skills，`python <skill>/scripts/launch.py` 默认启动 5020。
运行数据和依赖在用户应用数据目录 EasyRef 下，独立于 skill 和开发 worktree。

本地界面覆盖 Literature、Idea、Experiment、Paper、Polish、Review。Profile 保持
旧版模式组件，未新增本地入口。没有自动搬迁主实例项目或 DBLP 库，没有验证真实
付费翻译请求或任意科研任务质量；AI 浏览器测试使用确定性模拟结果。现有大 bundle
提示和 MLflow/SQLAlchemy noload 弃用提示仍在，不影响本轮通过项。
