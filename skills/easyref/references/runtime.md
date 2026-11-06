# 启动、数据与发行

包内含 `SKILL.md`、`agents/`、`references/`、`scripts/launch.py`、`app/` 和
记录来源提交/文件 SHA256 的 `manifest.json`。需要 Python 3.11+、Git；应用内
AI 还需要已登录的 Codex CLI。前端已构建，不需要 Node。PDF 编译需本机 TeX 引擎。

```powershell
python <skill目录>/scripts/launch.py
python <skill目录>/scripts/launch.py --prepare
python <skill目录>/scripts/launch.py --port 5020 --data-dir D:/EasyRefData
```

默认数据在 Windows `%LOCALAPPDATA%/EasyRef/data`，其他系统在
`~/.local/share/EasyRef/data`。运行环境在同级 `runtime/`，按包版本隔离；数据在
skill 外，升级不覆盖它。`--prepare` 只安装依赖；`--runtime-dir` 指定安装环境。
解释器位于该目录 `.venv`，首次联网安装后端 requirements，不改全局 Python 包。

启动器后台无窗口运行，返回 `url`、`pid`、`data_dir`、`log`，通过 `/api/status`
确认就绪。它拒绝占用端口和同数据目录的第二个打包服务。不要将 `--data-dir`
指向其他运行中的源码实例：旧启动器不持有这个锁。搬迁项目用界面导出/导入。

源码主服务一般在 5000，各组件开发实例在 5011–5016，不会被本启动器重启。
这些实例不是同一数据库。打包实例默认 5020，初始无用户文献库；可导入 DBLP，
或按 `app/docs/LITERATURE_CODEX.md` 通过本机 catalog API 只读查询已有库。
不要自动下载全量 DBLP 或复制数据库。

停止时核实返回 PID 的命令确属该服务，再终止；不按端口批量杀进程。
升级前停止旧打包服务，保留数据，备份现有 skill 目录后装新包。不同版本共用数据
必须串行，迁移后不自动降级。

维护者在源码仓库运行：

```powershell
python scripts/package_skill.py --output releases
python scripts/package_skill.py --output releases --install
```

打包器先构建前端，按 Git 跟踪白名单收集后端/文档和构建产物，生成 zip。
`--install` 安装到 `$CODEX_HOME/skills/easyref`（未设置时 `~/.codex/skills/easyref`），
已有目录拒绝覆盖。源码位于 `skills/easyref`，不要只修安装后的副本。
依赖、数据库、项目、密钥、日志、缓存不进入发行包。
