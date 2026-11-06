# Research Schema implementation and verification

Implemented incrementally in the existing EasyRef workbench. Existing uncommitted repository changes were retained. No commit, push or deployment was performed.

## Delivered code

| Files | Responsibility |
| --- | --- |
| `backend/app/research_schema/model.py` | 26 typed research objects, 16 relationship terms, state rules, reference/evidence checks, 0.9.0 migration |
| `backend/app/research_schema/schemas/` | 29 executable JSON Schemas and the local RO-Crate extension profile |
| `backend/app/research_schema/storage.py` | UTF-8/YAML parsing, atomic journal recovery, Handoff, event chains, SQLite/FTS5 rebuild, selected-object context |
| `backend/app/research_schema/exchange.py` | Safe import/preview/export, three modes, directory/ZIP, checksums, Git bundle, RO-Crate/PROV generation, recovery reports |
| `backend/app/research_schema/bridge.py` | Existing application tables → portable checkpoint; fresh-database restoration; reviewed file reconciliation |
| `backend/app/research_schema/analysis.py` | Optional read-only local Codex interpretation of an isolated nonstandard-import preview; explicit runtime approval handling |
| `backend/app/research_schema/versioning.py` | Immutable semantic submission snapshots, component diff/copy/revision, conflict-reporting three-way merge |
| `backend/app/research_schema/api.py` | Project controls, per-workspace object APIs, minimal context, recovery plan approval and local Codex startup |
| `backend/app/migrations/004_research_schema.sql` | Application checkpoint synchronization marker |
| `backend/easyref.py` | validate/import/export/status/resume/rebuild/timeline CLI |
| `backend/scripts/build_research_schemas.py` | Deterministic schema generation |
| `backend/scripts/research_schema_example.py` | Real Python fixture generation and opt-in local Codex integration checks |
| `backend/app/local_api.py`, `local_codex.py`, `local_experiments.py`, `local_versions.py`, `local_git.py` | Incremental API, selected-context, terminal-event checkpoint and Git integration; safe exporter replaces the legacy export route |
| `frontend/src/components/research/ResearchProjectTools.jsx` | Import preview/confirmation, optional analysis/approval, export, validation, recovery plan, timeline, shared object browser |
| `frontend/src/components/research/ResearchWorkbench.jsx`, `IdeaWorkspace.jsx` | Existing UI integration; notify Experiment after Blueprint creation completes |
| `backend/requirements-local.txt`, `.gitignore` | PyYAML dependency and tracked example execution log |
| `backend/tests/test_research_schema.py`, `test_integrity_edges.py` | Acceptance/security/compatibility tests and updated migration/export expectations |
| `frontend/tests/research-schema.spec.js`, `workbench.spec.js` | Real browser import/export and workspace persistence checks; wait for actual Blueprint creation |

See [protocol and developer guide](RESEARCH_SCHEMA.md), [profile](../backend/app/research_schema/schemas/PROFILE.md), and [openable example](../examples/research-schema/README.md). The example contains 17 real structured objects, three stable paragraphs/outlines, an interrupted task and a genuine Python-produced metrics file. Its arithmetic is synthetic TEST DATA, not a scientific benchmark result.

## Recorded verification

- Full backend suite: **64 passed** (`python -m pytest backend/tests -q --tb=short`). Final targeted recovery checks additionally verified the compatibility adapter keeps formerly running tasks interrupted.
- Frontend production build: passed. Vite still reports the existing large-bundle warning.
- Frontend link unit tests: **2 passed**.
- Real Chrome/Playwright browser suite: **3 passed**, including all five existing workspaces, anchored paragraph outlines, import confirmation, recovery plan and actual ZIP download.
- CLI validate/export/import/status/resume commands passed a real subprocess roundtrip, including UTF-8 JSON output on Windows.
- Standalone example: `python backend/easyref.py validate examples/research-schema` passed.
- Installed local Codex: **0.155.1**, authenticated through the user's existing ChatGPT login, app-server stdio. A real read-only context turn returned `TEST DATA: actual_value=17`. An initial 120-second attempt timed out; the isolated low-effort retry passed. No API key was introduced.
- Import-analysis live test: **passed** with actual local Codex. It cited README.md/model.py, identified the unevaluated state and unknown module purpose, and left the source untouched. Earlier attempts exposed a read-approval request and timeout; runtime requests are now displayed for explicit review, and bounded source excerpts with hashes eliminate unnecessary file-tool round trips. The final isolated test used low reasoning effort; normal application sessions inherit local CLI defaults.

Tests A/B/D/G cover full ID/relationship/file roundtrip, interrupted work, three pinned/locked outlines and rebuilding SQLite from files. C verifies a plain Python/config/CSV/LaTeX/BibTeX folder and explicit unknowns with no source mutation. E uses actual Git commits, a conference snapshot, a journal branch and semantic diff, then verifies a Git bundle and immutable original snapshot after import. F blocks a task missing data/weights/GPU requirements. H covers traversal, Windows paths/device names, symlinks, corruption, invalid references and secrets. I verifies the explicit 0.9.0 migration without ID or unknown-extension loss. Additional integration tests reconstruct existing workspace tables and exact submission ZIP bytes in a fresh database, exercise external-edit conflicts and crash-journal roll-forward, and preserve preview IDs during confirmation.

These tests establish the implemented local protocol behaviors. They do not certify arbitrary third-party archives, all research disciplines or every operating system.

## Remaining scope and reasons

- A public permanent RO-Crate profile URI and independent conformance certification are not supplied; the repository now contains a local documented extension and generator, and must not claim registration that has not happened.
- CWL export remains optional and unimplemented; the current repository has exploratory commands without a general typed workflow compiler.
- Full Git history is preserved as a verified bundle. Automatic branch reconstruction is not yet wired into import; manual Git recovery remains available.
- Native protocol objects are readable across all five workspaces. Some newly introduced object types use the common inspector rather than dedicated editing forms; existing edit forms retain their compatibility adapter.
- Native snapshot comparison/merge is a tested Python service API. A complete visual comparison/merge editor is not included.
- Dependency/GPU compatibility that cannot be established locally remains needs_confirmation and blocks continuation. There is no universal environment installer or process checkpoint restorer. `resume_process` is explicitly false.
- Rich BibTeX/CSV/TensorBoard parsers and automatic external-resource resolution remain future work. Imported result-file candidates do not become completed or verified experiments.
- Submission creation retains its existing immutable database/archive transaction and requires a subsequent explicit checkpoint/export for a portable snapshot. Other successful workspace API mutations and terminal experiment/Codex states checkpoint automatically; filesystem/database crash recovery is bounded by the last completed checkpoint.
- Secret detection is a combination of denylisted files and content heuristics, not a guarantee about all encodings or redistribution rights. Export reports enumerate omissions for review.

The implementation is a working protocol foundation and integrated migration/recovery path, not a claim that every advanced item in the original roadmap is complete.
