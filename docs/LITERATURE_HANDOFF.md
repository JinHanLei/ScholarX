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

## 页面内 PDF 阅读与划词浮窗

接续 `6cfdbc8`，按顺序合入：

1. `4653106`：共享组件 `frontend/src/components/PdfViewer.jsx` 增加可选 `toolbarContainer`，将现有缩放控件放入宿主工具栏。未传入的 Paper 等调用保留原有工具栏位置；缩放按钮补充无障碍标签及边界禁用状态。
2. 本记录所在的 Literature 功能提交：PDF 直接显示在文献主区域，48px 单行工具栏左侧返回文献列表；列表保留原排序和分页状态。翻译改成选文附近的浮窗，支持 Codex 翻译、停止、错误与授权提示；新选文不显示上一段的译文。笔记通过工具栏或选文浮窗打开，保存摘录、页码和笔记。滚动 PDF、点击正文或 Esc 可收起翻译浮窗。

模块文件为 `LiteratureReader.jsx`、`LiteratureWorkspace.jsx`、`literature.css`。没有后端、迁移或依赖变更。尚未合入 `main`。

验证：前端构建通过（已有大体积 bundle 提示）；现有前端单元用例 2 项、`test_literature_list.py` 后端用例 4 项通过。在 5011 的独立验收项目中确认：阅读区不在 dialog 中，只有一个 48px 工具栏；鼠标选文弹窗位于 PDF 区域内；真实 Codex 翻译重连后返回中文译文；笔记与第 1 页摘录成功保存；缩放 100% → 110% → 100%；Esc 只关闭浮窗；返回后年份升序与列表保留，重新进入正常。浏览器无 error/warn 日志。本轮未验证触屏选文，未运行包含其他工作区和旧界面选择器的全量浏览器套件。预览截图：`logs/pdf-inline-reader-final.png`。

## 阅读时隐藏底部导航

本记录所在提交接续 `7268992`，只修改 Literature 专用样式：PDF 阅读期间隐藏底部阶段导航并释放该行空间，返回列表自动恢复。无共享文件、后端、迁移或依赖变更。前端构建通过；浏览器确认阅读区延伸到视口底部，返回列表恢复导航，再次阅读重新隐藏。此轮仅调整样式，未重复运行后端测试。截图：`logs/pdf-reader-no-footer.png`。分支仍为 `codex/literature`，尚未合入 `main`。

## OpenAI API 划词翻译与 Logo 配置

接续 `67aac1d`，在 `codex/literature` 按顺序合入：

1. `d1e9ab5`：Literature 功能。划词翻译直接调用 OpenAI Responses API，逐段显示译文，支持停止与可读的错误提示；不再为翻译创建 Codex 会话。增加配置弹窗与实例级设置接口。PDF 自动抓取和文献检索继续使用原有流程。
2. 本记录所在的共享接线提交：唯一共享代码文件 `frontend/src/components/research/ResearchWorkbench.jsx`，将 EasyRef Logo 设为配置入口，挂载弹窗，并向阅读器传递打开配置的回调。需要与上一项一并合入，才能使用完整入口。

配置包含 API Key、API 地址和模型，默认官方地址与 `gpt-5.4-mini`，可手动修改。自定义地址需支持 Responses API。保存仅写入当前实例的 `private/translation.json`，不会进行连接测试，不写入项目文件、数据库或浏览器本地存储。Windows 使用当前用户 DPAPI 加密密钥；其他系统使用权限为 0600 的本地文件。读取配置不返回密钥，支持留空保留、更新和移除；更换 API 地址须重新提供对应密钥。翻译只发送用户选文与固定翻译指令，设置 `store: false`。没有迁移、依赖或全局 Codex 配置变更。

验证：`test_literature_translation.py` 与 `test_literature_list.py` 共 30 项通过；前端构建通过（已有 bundle 大小提示）；现有 research-links 单元测试 2 项通过。后端测试使用临时目录和模拟网络响应，覆盖密钥保存/加密/脱敏、设置校验、流式输出、鉴权/配额/超时/中断提示、缺少密钥阻止调用及不创建 Codex 会话。浏览器已确认 Logo 弹窗、空密钥禁用保存、PDF 选文的配置入口，以及阅读页继续隐藏底部导航。截图：`logs/openai-api-settings-final.png`。

隔离服务已更新并运行于 <http://127.0.0.1:5011/>。按用户要求，尚未填入真实密钥，也未请求真实 OpenAI API；实际翻译质量、首字延迟和总耗时留待用户填写配置后验证。未运行全量浏览器套件。尚未合入或推送 `main`。

接口依据：[Responses 流式事件](https://developers.openai.com/api/docs/guides/streaming-responses)、[GPT-5.4 mini 模型配置](https://developers.openai.com/api/docs/models/gpt-5.4-mini)。

## 配置弹窗内测试连接

本记录所在提交接续 `e35a4e5`，仍在 `codex/literature`。弹窗底部增加“测试连接”，使用当前表单中的地址、模型和新填写的密钥；密钥留空则使用已保存值。测试不会保存或覆盖配置，更换地址仍必须重新提供密钥。后端新增 `POST /api/settings/translation/test`，复用实际翻译的流式请求，只发送固定测试短句，输出限制为 256 tokens。界面显示示例译文、首字和总耗时；支持停止，修改字段后清除旧结果。保存配置保持独立操作。

仅修改 Literature 的设置弹窗、样式、翻译服务和测试，无共享文件、依赖或迁移变更。后端相关测试 36 项、现有前端单元测试 2 项通过，前端构建通过。新增覆盖未保存配置测试、已保存密钥复用、跨地址限制、缺少密钥、鉴权/超时/截断错误及不写入设置、不创建 Codex 会话。浏览器使用无效测试占位值验证按钮及错误/耗时显示，随后清空占位值，未保存配置，也未请求真实 OpenAI API。用户已有密钥保持不变。截图：`logs/openai-api-test-button.png`。

5011 隔离实例已更新。真实连接及延迟可由用户在弹窗内直接测试；尚未合入 `main`。

## 纯译文浮窗与阅读开关

本记录所在提交接续 `c6967ba`，分支 `codex/literature`。保存 API 配置成功后立即关闭弹窗，失败时继续显示错误。PDF 工具栏右上角增加“划词翻译”开关，每次进入阅读默认关闭；开启后选文自动调用 API，关闭开关会中止请求并收起译文。未配置密钥时点击开关会打开配置弹窗。

翻译浮窗仅显示译文，移除原文、标题、操作按钮和底部说明。首次译文到达前用工具栏图标显示等待状态，错误显示在阅读区提示条中。滚轮滚动不再清除选区或收起浮窗，译文保留在阅读视口内。通过选区边界去重避免 pointerup 与 selectionchange 重复请求；新选文、Esc 或关闭开关会取消旧请求。笔记仍从原工具栏打开。

仅修改 `LiteratureApiSettings.jsx`、`LiteratureReader.jsx`、`useLiteratureTranslation.js`、`literature.css` 及本记录，无共享代码、后端、迁移或依赖变更。前端构建通过，现有 research-links 单元测试 2 项通过。浏览器实际验证：保存原配置后弹窗关闭；默认关闭时选文不出现译文；开启后公开论文标题自动获得真实 OpenAI 中文译文；浮窗无标题、原文和控件；向下滚动后原文选区及译文均保留；关闭开关后浮窗消失。此次选词验证仅产生一次翻译请求。截图：`logs/pdf-translation-scroll-retained.png`。未运行全量浏览器套件或重复后端测试；5011 已加载新构建，尚未合入 `main`。
