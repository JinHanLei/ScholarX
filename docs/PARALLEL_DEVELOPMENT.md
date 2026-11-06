# 组件并行开发

每个组件使用独立的 **目录 + 分支 + Git 暂存区 + 服务端口 + 本地数据目录**。
主目录 `easyref/` 保留在 `main`，负责验收与合并。各工作目录包含完整工程，
但任务按组件分工。Git 历史、分支引用和仓库配置仍然共享；合并时仍可能出现
公共文件冲突，需要顺序处理。

## 目录与端口

工作目录位于主仓库旁的 `easyref-worktrees/`。以当前安装路径为例：

| 模块 | 工作目录（相对 easyref-worktrees） | 分支 | 应用/后端端口 | 热更新前端端口 |
| --- | --- | --- | --- | --- |
| Literature | `literature/` | `codex/literature` | 5011 | 5191 |
| Idea | `idea/` | `codex/idea` | 5012 | 5192 |
| Experiment | `experiment/` | `codex/experiment` | 5013 | 5193 |
| Paper | `paper/` | `codex/paper` | 5014 | 5194 |
| Review | `review/` | `codex/review` | 5015 | 5195 |
| 个人中心 | `profile/` | `codex/profile` | 5016 | 5196 |

端口配置的唯一来源是 `scripts/components.json`。原主目录的 5000/5180 服务保持原配置。

```powershell
# 在主仓库运行；创建前先提交共同基线。已有工作目录不会被重置。
.\scripts\setup-worktrees.ps1
# 只查看，不创建或修改
.\scripts\setup-worktrees.ps1 -List | Format-Table Component, Branch, Path, BackendPort, FrontendPort
```

新工作目录从已提交的 `main` 创建，未提交文件、`.env`、依赖、本地数据库和
构建产物不会自动复制。已有分支或工作目录会继续保留原来的进度，不会被脚本更新。
本机创建 worktree 不等于远端自动获得这些目录；其他机器需要重新运行脚本。

## 给新的 AI 任务指定目录

在 Codex 中以对应工作目录作为项目目录开始任务；现有聊天不会自动迁移。
例如 Idea 使用 `D:\projects\EasyRef\scholar\easyref-worktrees\idea`，可附上：

> 在 D:\projects\EasyRef\scholar\easyref-worktrees\idea 开发 Idea 模块，
> 分支为 codex/idea。先阅读 AGENTS.md，所有编辑与 Git 操作都在该目录内完成。
> 公共接口改动单独提交并在交付时列出，不操作其他工作目录或主分支。

一个 worktree 同时只分配给一个写代码任务。同一组件要开两个任务时，另建
`codex/idea-<task>` 分支和独立目录，并选择未占用的端口；不能同时复用 `idea/`。

## 启动与数据隔离

从主目录或任意组件目录调用均可，脚本会定位指定组件的 worktree：

```powershell
# 首次会在 Idea 目录创建自己的 .venv、安装依赖、构建前端并启动 5012。
.\scripts\start-component.ps1 -Component idea
# 依赖未变化时，之后可跳过安装（仍会构建前端）。
.\scripts\start-component.ps1 -Component idea -SkipInstall
# 需要热更新时，在第二个终端运行；API 指向 Idea 的 5012。
.\scripts\start-component.ps1 -Component idea -Service Frontend -SkipInstall
```

应用地址为 `http://127.0.0.1:5012`；热更新地址为 `http://127.0.0.1:5192`。
端口被占用时脚本会报错，不会停止已有服务或悄悄换端口。前端单独启动需要对应
应用服务已经启动；首次单独运行前端时不要加 `-SkipInstall`。

每个组件的数据默认在各自 worktree 的 `.easyref/`，初始为空。需要现有研究项目时，
使用应用的项目导出/导入功能创建开发副本；不要让两个服务直接使用同一数据库或
同一个外部研究项目目录。依赖、构建产物和数据不通过符号链接共享。

## 文件归属和共享改动

具体归属见根目录 `AGENTS.md`。新增样式优先放在模块专属 CSS 并在模块中导入，
新增后端逻辑放在模块服务中；公共入口仅保留必要接线。

涉及 `local_api.py`、`local_store.py`、`research.css`、共享组件、schema 或依赖时，
在本任务分支内完成必要修改，但单独提交、明确说明，合并时由集成人顺序处理。
数据库迁移只能新增，已有迁移不可改写；分配下一个编号前先协调其他分支，避免
两个分支各自新增同名迁移。测试专属文件优先新增到对应模块，避免多人改同一测试。

## 提交、合并与下一轮同步

```powershell
# Idea 工作目录中：仅暂存本任务涉及的文件，检查后提交。
git status --short --branch
git add frontend/src/components/research/IdeaWorkspace.jsx
git diff --cached
git commit -m "feat(idea): describe the change"
git push -u origin codex/idea

# 主目录中：主目录必须干净，逐个组件合并，冲突解决后再合并下一个。
git switch main
git pull --ff-only origin main
git merge --no-ff codex/idea
# 运行受影响的后端测试与前端构建，再推送。
git push origin main

# 下一轮开发前，在空闲且干净的 Idea 工作目录中同步共同基线。
git fetch origin
git merge origin/main
```

合并不会自动更新其他组件工作目录，也不会自动更新已运行的服务。各模块在空闲时
同步，重新构建/启动自己的服务。不要跨任务执行 `git reset --hard`、`git clean`、
`stash`、强推、删除工作目录或自动重启别人的服务。

常用检查：

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm --prefix frontend run build
node --test frontend/unit/research-links.test.mjs
```

浏览器测试使用独立验收数据，并设置 `EASYREF_TEST_URL` 指向相应实例。
