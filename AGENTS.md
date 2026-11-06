# EasyRef development

Read `docs/PARALLEL_DEVELOPMENT.md` before editing. This repository uses one Git
worktree per component, defined in `scripts/components.json`.

## Worktree discipline

- Run `git status --short --branch` and `git worktree list` before making changes.
- The primary `easyref` directory on `main` is for integration. Feature tasks use
  the matching sibling `easyref-worktrees/<component>` on `codex/<component>`.
  If a task starts in the primary directory, locate the matching worktree with
  `scripts/setup-worktrees.ps1 -List` and run feature commands there.
- Work only inside the task's assigned worktree. Do not edit, stage, reset,
  stash, switch branches, clean, or commit in another task's worktree.
- One active writer per worktree. Two tasks for the same component need distinct
  task branches/worktrees; do not reuse the occupied directory.
- Stage explicit paths. Feature commits and pushes target their component
  branch; only an integration task merges into and pushes `main`.
- Worktrees have independent files, HEAD and index, but share refs and Git
  configuration. Do not change repository-wide config or install global hooks
  as part of a component task.

## Component boundaries

- Literature: `Literature*.jsx`, `useLiteratureAssist.js`, `literature.css`,
  `backend/app/local_literature.py`, `backend/app/local_library.py`.
- Idea: `IdeaWorkspace.jsx`, `ResearchStart.jsx`, `backend/app/local_workflow.py`.
- Experiment: `ExperimentWorkspace.jsx`, `backend/app/local_experiments.py`.
- Paper: `PaperWorkspace.jsx`, `backend/app/local_paper.py`, `backend/app/local_latex.py`.
- Review: `ReviewWorkspace.jsx`, `backend/app/local_review.py`.
- Profile: `frontend/src/components/profile/**`.
- Research frontend filenames above live in `frontend/src/components/research/`.
  Add module-specific helpers/styles beside them or in a module subdirectory.

Shared integration points include `main.jsx`, `styles.css`, `research.css`,
`ResearchWorkbench.jsx`, `ResearchAssistant.jsx`, `ResearchModal.jsx`, project
dialogs/tools, `shared.jsx`, `PdfViewer.jsx`, `utils/**`, `i18n/**`, `local_api.py`,
`local_store.py`, `local_codex.py`, `local_git.py`, `local_versions.py`,
`local_proposals.py`, `research_schema/**`, legacy API/DB code, dependency files,
and development scripts. When shared changes are necessary for the requested
feature, keep them small, use a separate commit and identify them in the handoff
so the integrator can merge them in order. Do not block authorized work merely
because a shared file is needed.

## Runtime and verification

- Use `scripts/start-component.ps1 -Component <name>` for isolated ports and
  `.easyref` data. Never point concurrent services at the same SQLite/project
  directory. Never copy the user's live database as an automatic setup step.
- Dependencies and build outputs stay in each worktree; do not symlink
  `.venv`, `node_modules`, `dist`, or `.easyref` between tasks.
- Existing database migrations are immutable. Coordinate the next migration
  number across branches; preserve each migration's bytes when integrating.
- Run relevant backend tests, `npm --prefix frontend run build` for frontend
  changes, and relevant existing unit/browser tests. Use isolated test data.
- Hand off branch, commit, changed shared files, migration/dependency changes,
  validation results and remaining limitations. Integration is sequential and
  must preserve other tasks' changes.
