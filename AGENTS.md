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

- For research-content requests such as drawing/changing the user's backbone,
  use the live Idea API/`backend/scripts/idea_canvas.py` described in
  `docs/IDEA_CANVAS.md`. First read the active context at the correct instance
  (Idea development: port 5012), verify the project, then read the current
  document/revision. Read `/api/idea-context` directly; do not ask the user to
  copy model content or project/Idea IDs into the chat. Preserve stable node IDs and user layout. Save model edits
  as drafts only. The user clicks “保存为版本” to create the shared Idea/Experiment
  version and start execution. Do not call the publish endpoint or CLI command
  unless the user explicitly requests version submission; editing alone is not authorization.
  Never substitute edits to application source, SQLite, or research export files
  for updating the user's model canvas.

  When a research discussion settles a change, record one decision through
  `POST /api/projects/<pid>/ideas/<id>/records` (or CLI `record`), atomically with
  the complete document and expected revision. Include a stable UUID, title,
  change, reason and expected validation; reuse the UUID on network retries.
  Author `document.figure` as a paper-style vector figure, not draggable cards.
  Preserve prior records; after results are discussed, append a conclusion
  referencing the exact version and experiment IDs. Read metrics from the runs.
  Do not log every chat message or unrelated application-development work as
  a research decision. The active-context endpoint supplies this workflow too.

- For experiment result-table and interpretation work, read
  `GET /api/projects/<pid>/experiment-results` on the correct instance (Experiment
  development: 5013). Map existing metric keys to Baseline/Ours through the report
  endpoint; never invent values or retroactively attach historical runs to Vn.
  Append observations via the run notes endpoint; it records the actual parameter
  and metric snapshot. See `docs/EXPERIMENT_RESULTS.md`. These actions do not start
  experiments; explicit version submission or run execution controls do.

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
