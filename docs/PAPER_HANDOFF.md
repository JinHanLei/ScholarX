# Paper editing handoff

Branch: `codex/paper` in `easyref-worktrees/paper`. Main and other component worktrees were not edited.

## Merge order

1. `76fc573` — shared translation result transport and reusable polling hook.
2. `1442a7a` — Paper outline, selection revision, planning, drafting and tests.
3. `0caee31` — register Paper API routes in the shared local API.

The shared changes are `backend/app/local_text_assist.py` (new),
`backend/app/local_library.py`, `frontend/src/components/research/useLiteratureAssist.js`,
and `backend/app/local_api.py`. The first two existing helpers belong to Literature;
their existing request/response contract remains compatible. Integrate these small
changes carefully with concurrent Literature work. Merge all three commits before
deploying the feature.

No migration, dependency declaration, lockfile, repository configuration, or global
hook changes. Dependencies and test data live only in this component worktree.

## Behavior

- The bottom paragraph-outline rail stays visible, scrolls horizontally, follows
  reading position, and navigates to paragraphs. It displays saved writing purposes.
- Enable 划词修改 and select text in one paragraph in source-reading mode. Enter
  revision instructions, inspect/edit the suggestion, then apply it. Browser UTF-16
  offsets preserve repeated words and astral characters. Applying checks the original
  file hash and exact selection; paragraph IDs and source history are preserved.
- Missing or empty manuscripts show a plan-first workflow. It retrieves actual
  matching-venue records from the local index and Crossref, then requests a section
  and paragraph plan. The user can revise paragraph purposes before starting a draft.
  Draft preview is saved as a new `.tex` file with citations and paragraph outlines.
  Existing filenames are never silently overwritten.
- AI operations use the same read-only Codex session/output-schema transport and
  result polling as translation. Results remain in the existing session storage.

## Validation

- 40 unique backend tests passed across `test_local_workbench.py`,
  `test_library_ui.py`, `test_latex_adapter.py`, `test_codex_adapter.py`,
  `test_integrity_edges.py`, and `test_paper_assist.py`.
- `npm --prefix frontend run build` passed (existing large-bundle warning).
- `node --test frontend/unit/research-links.test.mjs`: 2 passed.
- New `frontend/tests/paper.spec.js`: 2 passed, including narrow viewport,
  scroll synchronization, exact selection and plan-before-draft behavior.
- Existing `workbench.spec.js` five-workspace persistence/outline/PDF test: passed.
- Browser tests used local Edge with `EASYREF_TEST_URL=http://127.0.0.1:5014`.
- A real Crossref query returned HTTP 200 and TKDE records. AI responses were mocked
  for deterministic tests; live model quality was not evaluated in this task.

## Runtime and current limits

Preview: `http://127.0.0.1:5014`, launched with
`scripts/start-component.ps1 -Component paper -SkipInstall`. The isolated `.easyref`
contains clearly named TEST DATA projects, not a copy of the user's live database.

Selection revision and outline tracking currently operate on anchored LaTeX source
reading, not PDF text or cross-paragraph selections. Crossref planning uses metadata
and available abstracts, not automatic full-text reading. No search hits or network
failure without local matches produces an explicit error, not invented references.
Drafting defaults to English plain text converted to a basic LaTeX article; missing
evidence is requested as TODO text. Generated claims still require author review.
Switching away from the planner clears its local preview; Codex sessions retain the
underlying result. New drafts do not automatically mark the research workflow complete.

## Related open-source work

- STORM: https://github.com/stanford-oval/storm — separates reference collection and
  outline construction from full article writing. Its focus is Wikipedia-like reports.
- OpenScholar: https://github.com/AkariAsai/OpenScholar — retrieval-grounded scientific
  literature synthesis. Useful as a future retrieval/synthesis backend.

These projects were researched as references; neither was installed or embedded.
