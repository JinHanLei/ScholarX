# EasyRef Research Schema

This implementation adds portable research checkpoints to the existing Flask, React, SQLite/FTS5, Git and local Codex architecture. It introduces no cloud database, API-key dependency, RDF server or workflow engine. The protocol version is `1.0.0`; the product name remains EasyRef.

## Audit and adopted standards

The existing implementation had stable components/revisions, experiment records, paragraph anchors/outlines, immutable submission archives and a version-checked Codex app-server adapter. `research/<kind>/<id>.json` covered only some components; outlines, reviews, evidence, sessions and submissions still required the application database. The old project ZIP exporter copied ordinary files without comprehensive secret/path filtering and lacked a corresponding protocol importer. It now routes through the protocol exporter.

Official specifications checked on 2026-11-03:

| Standard | Adopted revision and purpose |
| --- | --- |
| [RO-Crate](https://www.researchobject.org/ro-crate/specification/1.3/root-data-entity.html) | 1.3, latest release shown by the specification; Dataset/file exchange |
| [PROV-O](https://www.w3.org/TR/prov-o/) | W3C Recommendation 2013-04-30; constrained provenance mappings |
| [JSON Schema](https://json-schema.org/specification) | Draft 2020-12; executable field/type/format constraints |
| [Agent Skills](https://agentskills.io/specification) | Published unnumbered specification: SKILL.md frontmatter and body; existing local skill catalog retained |
| [AGENTS.md](https://agents.md/) | Unnumbered convention; imported content remains untrusted project data |
| [CWL](https://www.commonwl.org/specification/) | Stable 1.2.0 identified; optional CWL export is not implemented |

The bundled [profile](../backend/app/research_schema/schemas/PROFILE.md) documents EasyRef extensions and legal PROV mappings. It is not a registered public RO-Crate profile. JSON-LD generation and local profile checks are implemented; independent third-party RO-Crate conformance certification has not been performed.

## Files and source of truth

```text
research.yaml                  canonical portable checkpoint: objects, relations, file manifest
handoff.yaml                   validated current-state summary
ro-crate-metadata.json          derived RO-Crate JSON-LD
history/events.jsonl            append-only events with predecessor hashes
schemas/*.schema.json          full protocol and per-object JSON Schemas
schemas/PROFILE.md              local extension profile
research-assets/                transferred application-managed PDFs, logs, submission snapshots
submissions/<stable-id>.json    immutable semantic snapshots (native protocol API)
.easyref/research-index.sqlite3 rebuildable object/relationship/FTS5 index; excluded from export
```

Code, configurations and `.tex` files remain in their existing locations. Paragraph comments remain the identity anchor; paragraph location is a reference rather than a second authoritative LaTeX body. A ParagraphOutline is an independent object, including locked/pinned state and evidence/claim associations.

The checkpoint is the portable authority. Existing workspace forms still stage edits in the application SQLite database, then checkpoint successful API mutations. Codex completion and experiment terminal states also checkpoint. Explicit export and Git checkpoint flush all project tables. The `extensions.sqlite_projection` payload is a derived compatibility projection used to reconstitute the existing five workspaces; it is not an independent editing interface. Only project references are exported from the DBLP/CCF library, together with the required venue metadata, never the global index.

A successful file checkpoint uses an fsynced write-ahead journal and atomic file replacement, then rebuilds the index. A crash between replacements rolls forward on the next local read. Corrupt journals/events and mismatched hashes are reported. SQLite and the filesystem are not a distributed transaction: API responses report `checkpoint_required` if staging succeeded but durable checkpointing failed. Direct service callers must checkpoint at their own operation boundary. Submission creation currently requires a subsequent explicit project/Git/export checkpoint; its existing immutable database/archive transaction remains unchanged.

Manual protocol edits are validated before reading. Existing application projects detect a changed document hash and refuse to overwrite it. `POST /api/projects/<id>/research/reconcile` accepts the reviewed document's `expected_hash` and reconciles existing components/outlines, rejecting concurrent SQLite edits. Reconciliation of arbitrary new object types into every legacy editing form is not yet implemented. The shared object browser and standalone protocol reader can read all types. Unknown fields are retained; consumers must not treat unknown extensions as instructions or execution capabilities.

## Object vocabulary

All objects require `id`, `type`, `project_id`, `title`, `created_at`, `updated_at`, `revision`, `status`, `validation_status`, `approval_status`, `location`, `provenance`, `related_objects`, and a typed `data` payload. New IDs/revisions are UUIDs. Existing opaque IDs remain valid. Timestamps are timezone-qualified RFC 3339 date-times. Unknown optional values are omitted; explicit null is allowed only where the schema specifies it. `unknown`, `not_started` and `needs_confirmation` express different states; they do not imply success or zero measurements.

| Workspace/domain | Object types |
| --- | --- |
| Project | ResearchProject, Task, AgentSession, SkillRun, Artifact |
| Literature | LiteratureReference, Evidence |
| Idea | Idea, ResearchQuestion, Hypothesis |
| Experiment | ModelBlueprint, ModelModule, Experiment, ExperimentRun, ResearchClaim |
| Paper | Paper, PaperSection, PaperParagraph, ParagraphOutline, Figure, Table |
| Review | Review, ReviewIssue, Decision, SubmissionAttempt, VenueProfile |

Each type has a standalone schema under `backend/app/research_schema/schemas/`; `research.schema.json` embeds them as `$defs`. `build_research_schemas.py` regenerates those committed artifacts. Object references are stable ID strings, resolved against the project's object registry. Cross-project reference federation is deliberately rejected in this profile.

## Relationship vocabulary

All edges are directed source→target and carry a stable ID, provenance and an evidence array. All require endpoint existence/type checks. `Entity` means a non-activity research object; `Activity` means ExperimentRun, SkillRun or AgentSession. The executable vocabulary is `model.RELATIONS`.

| Relation | Source → target | Evidence | Automatic |
| --- | --- | --- | --- |
| derived_from | Entity → Entity | optional | yes |
| depends_on | any → any | optional | yes |
| uses | Activity → Entity | optional | yes |
| implemented_by | Hypothesis/Blueprint/Module → Blueprint/Module/Artifact | optional | yes |
| evaluates | Experiment/Run → Hypothesis/Blueprint/Module/Claim | optional | yes |
| produces | Activity → Entity | optional | yes |
| supports, contradicts | Evidence/Run/Reference → Claim/Hypothesis | required | no |
| describes | Paper/Section/Paragraph/Outline/Figure/Table/Idea → Entity | optional | yes |
| cites | Entity → Reference | optional | yes |
| addresses | Task/Decision/Run/Paragraph → ReviewIssue/Question/Hypothesis | optional | yes |
| blocks | any → Task/Run | optional | yes |
| supersedes | Entity → Entity | optional | no |
| belongs_to | any → Project/Blueprint/Paper/Section/Review/Experiment | optional | yes |
| generated_by | Entity → Activity | optional | yes |
| submitted_as | Paper/Project → SubmissionAttempt | optional | no |

Provenance has `kind: fact | inference | hypothesis`, an explicit actor and source locators. No heuristic scanner result is labeled verified. Legacy verification labels are conservatively downgraded unless the portable evidence requirements can be established.

## State and recovery

Task status: pending, in_progress, blocked, interrupted, completed, failed, cancelled. Validation: unknown, unverified, needs_confirmation, verified, rejected, stale. Approval: not_required, required, pending, approved, rejected. Experiment execution, review resolution and submission outcome have separate enumerations in their typed payloads.

The executable task transition graph rejects failed→completed and terminal→completed shortcuts. A failed task must return to pending for retry; dependency cycles are rejected. Completion requires explicit verification records. Interruptions preserve completed steps, written files, successful commands, process observations, reusable outputs, Git changes and preflight checks. The process observations are historical evidence, not live process handles.

`handoff.yaml` lists resolvable active/completed/pending/blocked tasks, blueprint, runs, paper, reviews, decisions, environment requirements, missing dependencies, approvals and next actions. Manual summaries can be read and validated; a new checkpoint regenerates the summary from canonical objects. `resume_context` and a reviewable `resume_task` plan are supported. `resume_process` is always false in this implementation.

The Recovery Report provides ten evidence-linked sections: goal, completed work, model, experiments, verified results, missing validated results, paper, review issues, last recorded decision and next actions. Environment strings that have not been checked remain needs_confirmation and block execution. This implementation does not install dependencies or probe imported executables during import.

## CLI outside EasyRef

Install `backend/requirements-local.txt`. Neither the server nor a Codex login is required for validation/import/export/status. Commands are:

```powershell
python backend/easyref.py validate examples/research-schema
python backend/easyref.py import C:/research/source
python backend/easyref.py import C:/research/source --destination C:/research/copy --confirm --fingerprint <preview-fingerprint>
python backend/easyref.py export examples/research-schema --output C:/research/project.zip
python backend/easyref.py export examples/research-schema --output C:/research/archive --mode reproducible --git-history
python backend/easyref.py status C:/research/copy
python backend/easyref.py resume C:/research/copy
python backend/easyref.py rebuild C:/research/copy
python backend/easyref.py timeline C:/research/copy
```

`resume --execute` prints the plan, checks prerequisites, requires interactive `APPROVE`, then uses the installed Codex app-server. Runtime approval requests are shown and require explicit JSON responses. No imported shell script is directly launched. The GUI equivalent is Continue Research → review plan → approve local Codex. It creates a fresh session with structured context rather than pretending to resurrect a vanished session.

The adapter continues to generate/validate JSON-RPC schemas from the installed CLI. Selected components and their one-hop relations plus Handoff enter the assistant context. Existing explicit messages/tool outcomes are retained in the projection; hidden reasoning events remain excluded by the existing adapter.

## Exchange and security

Import preview is read-only. Confirmation binds to the scanned source fingerprint, then builds a separate working copy. ZIP validation rejects traversal, absolute/drive/ADS paths, reserved device names, NUL/control characters, symlinks/special files, case collisions, duplicates, encrypted archives and bounded archive bombs. Every required file is hashed; corrupted payloads and unrecognized versions fail. Ordinary repositories yield file-backed candidates and explicit unknowns, including Python model candidates, LaTeX papers and result-file candidates. The optional local Codex analysis button creates an isolated copy and a read-only app-server session. Its structured interpretations must cite existing files and candidate IDs, remain inference/needs_confirmation, and require the final import confirmation. Failed or timed-out analysis is reported. This analysis path has automated control tests and a successful real local Codex interpretation check; the separate real CLI context smoke is also verified. CSV existence is not proof of a completed experiment. BibTeX is preserved as an artifact without inventing parsed references.

Metadata mode excludes source payloads and explicitly lists external resources. Portable mode includes safe lightweight source/config/paper/result files. Reproducible mode additionally allows a verified Git bundle; complete history is scanned for private paths and secret patterns before bundling. Git bundle import preserves the bundle as a file; reconstructing all branches from it is currently a manual Git operation. Large files become hashed external-resource entries. Locked environments and data references are preserved when provided, not fabricated.

Private runtime folders, credential filenames, `.env*`, private-key containers and local database files are excluded. Content patterns block likely credentials; structured metadata containing a detected secret blocks export. Inspected ZIP snapshots may be included; opaque/nested archives are excluded. Secret scanning is heuristic and cannot establish dataset redistribution rights or detect every possible secret encoding. Review `export-report.json` before sharing.

`versioning.py` implements immutable semantic snapshots, component comparison, explicit copy/revision and conflict-reporting three-way field merges. Existing workspace Git branch/restore and submission ZIP workflows remain available. Native semantic snapshot comparison and merge are Python service APIs, not full GUI editors.

## Compatibility and remaining work

The explicit 0.9.0 fixture migration renames revision_id, supplies approval_status and preserves IDs/extensions. Other versions fail closed. The protocol is not claimed compatible with arbitrary historical exports: those require separate adapters.

Remaining work: publish/register a permanent RO-Crate profile; independent full RO-Crate validation; richer BibTeX/CSV/TensorBoard interpretation; automatic environment reconciliation; full five-workspace editing for every newly defined object; GUI snapshot comparison/merge; CWL export; automatic Git-bundle branch reconstruction; process checkpoint restoration. These are not represented as completed features.

Tests cover A/B/D/G roundtrip/interruption/outline/index behavior; C file-based nonstandard preview; F missing resources; H archive/reference/secret/corruption protections; I explicit migration. Application-level tests restore real existing workspace objects and immutable submission ZIPs into a fresh SQLite data directory. Synthetic fixture metrics are labeled TEST DATA, never scientific findings.
