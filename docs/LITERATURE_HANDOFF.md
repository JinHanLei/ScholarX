# Literature 更新交付

工作目录：`easyref-worktrees/literature`，分支：`codex/literature`。
预览：<http://127.0.0.1:5011>。按 `scripts/start-component.ps1 -Component literature -SkipInstall` 启动。
预览数据为独立的测试项目，没有复制主目录数据库。

## 合并顺序

1. `ea24711` — `feat(codex): scope web search configuration to individual sessions`。
   唯一公共运行时代码改动为 `backend/app/local_codex.py`：新增可选的会话级 web_search 配置，恢复会话时保留配置。未传入时保持原行为。独立测试为 `backend/tests/test_literature_codex_config.py`。
2. 本记录所在的 Literature 功能提交：五列单行列表、复合排序、归档弹窗、文章链接、本地与网络合并检索、精简 PDF 上传及自动抓取。

没有数据库迁移、依赖版本或全局 Codex 配置变更。没有改动其他组件工作目录。

## 验证

- 相关后端用例累计 35 项通过，覆盖原有 workbench、Codex adapter、会话配置、文献收藏、复合排序、归档隔离、网络来源记录、筛选条件、去重和 PDF 保存。
- 前端构建通过；现有 research-links 单元测试 2 项通过。
- 浏览器实际验证：排序升序/降序/取消及优先级编号；PDF 状态排序；归档及恢复；标题 URL；关键词检索；本地+网络结果合并及网络论文加入自选；系统文件选择及上传；360px 单行布局。
- 真实 Codex 网络检索返回 Attention 与 Transformer-XL，并合并本地重复记录。
- 真实 Codex 自动查找并下载 Attention 官方 PDF；11 页可正常阅读。测试中的网络请求经历连接重试后完成。

## 使用范围

网络开关默认关闭。打开时由 Codex 使用实时 web search，最多返回 15 条有来源链接的网络候选，与可分页的本地结果一起展示；加入自选时才持久化网络文献。CCF 等级来自本地注册表，不能匹配的期刊会议保持未知。

自动抓取只接受公开 PDF 候选，检查文件可读性后保存到该实例的集中 PDF 目录。找不到公开全文或下载失败时显示原因，仍可手动上传。功能依赖当前 Codex 登录、模型及网络可用性。

## 网络检索按钮调整

在 `af52579` 后追加本记录所在的样式提交：网络检索改为检索按钮右侧的块状按钮，点击开启或关闭，开启时高亮。自然语言、关键词和高级检索共用该按钮；默认关闭和检索行为保持一致。

仅修改 `LiteratureSearch.jsx`、`literature.css` 和本交付记录，无共享代码、迁移或依赖变更。前端构建通过；浏览器已确认位置、显示效果及开启/关闭状态。此轮为界面调整，未重复调用 Codex 检索或运行后端测试。预览仍使用 5011 端口的隔离实例，尚未合入 `main`。
