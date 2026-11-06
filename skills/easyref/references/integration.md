# 应用分支集成

仅用于用户请求维护/合并代码。包内 app 不是 Git 工作区，先定位源码仓库。

1. 阅读 AGENTS.md、docs/PARALLEL_DEVELOPMENT.md、scripts/components.json。
   主 integration worktree 检查 `git status --short --branch` 和 `git worktree list`；
   `scripts/setup-worktrees.ps1 -List` 定位组件。只读检查其他工作区，不替其他任务
   提交、stash、reset、清理或重启。未提交改动不能声称已合并。
2. fetch、比较 main 与远端，干净主目录只 fast-forward 同步。记录各目标 SHA、
   未合提交和交付说明。分支期间前进则复核新增范围，不抢占活动 worktree。
3. 按祖先/共享依赖顺序逐一 `merge --no-ff`，通常 Literature、Idea、Experiment、
   Paper、Review；Profile 无新增则记录覆盖，不制造提交。冲突先解决再继续。
4. 语义检查：Codex web_search 与 workspace 同时有效；保留 Literature 最新路由；
   Paper 轮询支持 resource 参数且 generation 只声明一次；主界面保留 API 设置、
   Idea/Experiment 联动、切页草稿刷新、Polish/Review 独立进度。检查旧 CLI/skill
   调用者，避免 Review 默认模式变化造成兼容问题。
5. 逐个比较源 migration blob，保持历史迁移字节不变，撞号时协调新迁移。
   依赖仅装当前工作区；Windows 文件锁可尝试非删除式 npm install 并核对 lockfile，
   不为解锁终止别的服务。
6. 跑 backend/tests、前端 build、单元及相关浏览器测试。浏览器用空闲端口运行
   backend/scripts/serve_experiment_ui_test.py 的临时隔离服务并设置 EASYREF_TEST_URL，
   不往主库写验收数据。
7. 集成修复/共享接线/skill 打包明确提交，显式 stage。复核所有目标 SHA 都是 main
   祖先、无冲突标记/未完成合并。授权含推送时验证后正常 push main，不强推或改
   组件分支；否则报告本地状态。

交付源/合并 SHA、共享文件、迁移/依赖、测试通过/跳过/失败、运行端口及限制。
组件工作区后续同步由各任务完成；源码版本与应用内研究版本 Vn 是两件事。
