# Review: reviewer responses and a separate adversarial stage

Branch: `codex/review`. Worktree: `easyref-worktrees/review`.
Integrate the component commit `2b989fd` followed by the shared wiring commit
containing this document (or merge the branch as a whole). Main and other
component worktrees have not been modified.

## Behavior

- Review starts from pasted external reviewer/editor comments, optional author
  instructions and an English/Chinese reply language.
- Codex first extracts exact source quotations with stable comment IDs, then
  reads the project, performs feasible local changes/checks and fills each reply
  with evidence, actual changes, validation and remaining blockers.
- Source text and parsed comments survive failures/stops. Sessions remain
  inspectable. The UI supports editable saved replies, revision conflict checks,
  history, retry from the original text and Markdown export with processing records.
- A separate `Polish / 对抗审查` navigation stage contains the existing role-based
  pre-submission review. Historical reviews without a mode remain in this stage.
  Submission snapshots remain accessible from a collapsed panel in Review.
- The two stages have separate history and progress. A project cannot start
  concurrent review/rebuttal workers through this service.

## Shared changes

- `backend/app/local_api.py`: adds `PATCH /api/reviews/<id>/responses`.
- `frontend/src/components/research/ResearchWorkbench.jsx`: Review label,
  separate Polish stage, component routing and progress hook. The legacy workflow
  `review` phase maps to Polish; rebuttal progress comes from actual review jobs.
- `frontend/tests/workbench.spec.js`: new labels and six-stage assertions.

No migrations, dependency/lockfile changes or repository-wide configuration.
New rebuttal state is stored in the existing `reviews.scope_json` column.
`POST /projects/<id>/reviews` now defaults to rebuttal and requires `source`;
adversarial callers must send `mode: "adversarial"` (the relocated UI does).
The existing Codex adapter and research schema are unchanged.

## Verification

- Related backend suite: 42 passed (`test_local_review`, `test_local_workbench`,
  `test_easyref_workflow`). After adding three invalid-input cases, all 16 Review
  tests passed again; 45 distinct backend cases covered in total.
- Frontend production build passed; existing large-bundle advisory remains.
- Both existing workbench browser tests passed, and the new Review browser test
  passed after the final layout changes. The latter covers progress, automatic
  population, blocked work, saved edits/reload, export and mobile navigation.
- Existing research-link unit tests: 2 passed.
- Real installed Codex integration passed on an isolated TEST DATA project. It
  extracted two requests, changed `paper/main.tex`, executed `python check.py`
  (exit 0, `TEST DATA arithmetic check: PASS`) and populated both replies with
  evidence. Transport reconnects were observed before completion.
  Local evidence: `logs/review-smoke-result.json`; session tool events are retained
  in this worktree's isolated `.easyref` database. No live user database was copied.

## Runtime and limits

Development preview: `http://127.0.0.1:5015`, launched with
`scripts/start-component.ps1 -Component review -SkipInstall`.
This preview uses only the review worktree's dependencies and `.easyref` data.

Replies are drafts, including when automatic processing completes. Missing data,
dependencies or permissions produce blocked responses; the app never labels them
verified/resolved automatically. Structured component proposals still use the
existing adoption interface. Stopping does not undo edits already performed.
The live integration test verifies a small local edit/check, not a long training
workload or the scientific quality of arbitrary rebuttals. No automatic submission
or external sending is implemented. This branch has not been merged into main.
