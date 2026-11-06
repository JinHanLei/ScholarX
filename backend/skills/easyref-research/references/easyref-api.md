# Local EasyRef API contract

Use `api_base`, `project_id` and `session_id` from the supplied project context.
All JSON requests use UTF-8. Check HTTP status and actual response; a saved file
does not imply successful adoption. Do not access another project's records.

- GET `/projects/{project_id}/research-brief`: versioned problem and target venue.
- GET `/papers?q=...&offset=0&limit=30`: local FTS; response `papers` and `total`.
  Default `source=ccf`; also query `source=personal` for saved arXiv references.
  Search narrow title terms and inspect metadata. Never download all papers.
- POST `/papers/{paper_id}/library`: `{project_id, notes, tags: []}` adds a
  retrieved reference to this project's library.
- POST `/papers`: accurate metadata `{title, authors: [names], year, doi, url,
  metadata:{abstract,accessed_at}}` for a missing personal reference. Response `{id}`; follow with
  library call. Personal references do not acquire a CCF ranking by assertion.
- GET `/projects/{project_id}/components?kind=idea` (or blueprint/claim/table).
  Propose changes via `.easyref/proposals/name.json` rather than overwriting
  exports. For new components use `{kind,name,data,purpose}`; for edits also
  supply `component_id` and its current `expected_revision`.
  Blueprint `data` should include `markdown` (design and boundaries), `code_entry`
  (relative script), `modules:[{id,name,description,code_path}]` and
  `edges:[{source,target}]` referencing module IDs, so the architecture renders.
  Extra provenance fields are preserved. A pending proposal is not an adopted
  Blueprint; do not claim a run is linked to it without a real revision ID.
- GET `/projects/{project_id}/experiments`: reuse completed compatible runs.
- POST `/projects/{project_id}/experiments`: `{name, command:["python",
  "scripts/pilot.py"], config:{dataset,split,seed,hyperparameters:{},
  evaluation_protocol}, metrics_path:"results/metrics.json", purpose,
  blueprint_revision?, parent_id?}`. The script must exist inside the project.
  Response `{experiment}` with its ID. The project's `python_executable` setting
  determines the runtime and is frozen into the run. No `-c` or shell commands.
- POST `/experiments/{id}/start`: `{authorized:true}` only within a user's
  instruction to execute the described experiments. This launches real local
  compute. Runner sets `EASYREF_CONFIG`, `EASYREF_RUN_ID`,
  `EASYREF_METRICS_PATH`. Script must write NEW finite JSON numeric metrics to
  that last path. Keep detailed arrays/tables as separate project artifacts.
- GET `/experiments/{id}`: `{experiment,log,artifacts}`. Check status, error and
  actual metrics. Empty metrics are not a scientific success. Failed runs are
  retained; corrected code requires a NEW registration, never rewritten history.
- GET `/experiments/compare?left={id}&right={id}` returns protocol differences.
- POST `/projects/{project_id}/reviews`: `{roles:["Methodology Reviewer"],
  max_rounds:1,max_seconds:600,instructions,selected:[{kind,id}]}`. Fresh
  read-only sessions; structured findings remain in Review. Do not recursively
  start reviews from a reviewer session. GET `/reviews/{id}` tracks results.
- POST `/projects/{project_id}/paper/import`: `{filename:"main.tex",source}`
  creates a new anchored `.tex` under `paper/`. Response is document with `path`,
  `source`, `sha256`, `paragraphs`. Refuses overwriting an existing filename.
- GET `/projects/{project_id}/paper?path=paper/main.tex` then PUT
  `/projects/{project_id}/paper` with `{path,source,expected_hash:sha256}` for
  revisions. Keep anchors and locked outlines. For already-created source,
  POST `/projects/{project_id}/paper/anchors` with `{path}`.
- POST `/projects/{project_id}/paper/compile`: `{path:"paper/main.tex"}`. Inspect
  returned `status`, `pdf`, `log`, `error`; only successful compilation is a PDF.
  Support files such as `.bib`, `.sty`, figures live alongside source.
- GET `/projects/{project_id}/workflow`: artifact-checked workflow state.

Reviews and experiments are asynchronous. Poll with sensible intervals, report
new findings, and persist IDs before moving on. Do not equate a completed Codex
turn with a completed run or a review verdict with publication readiness.
