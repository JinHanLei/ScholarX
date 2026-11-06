CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
 settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE venues (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, abbreviation TEXT NOT NULL, rank TEXT NOT NULL CHECK(rank IN ('A','B','C')),
 discipline TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('Conference','Journal')),
 edition TEXT NOT NULL, source_url TEXT NOT NULL, verified_at TEXT NOT NULL
);
CREATE TABLE venue_aliases (venue_id TEXT NOT NULL REFERENCES venues(id), alias TEXT NOT NULL, PRIMARY KEY(venue_id,alias));
CREATE TABLE venue_dblp_mappings (
 id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(id), stream TEXT NOT NULL UNIQUE,
 source_url TEXT NOT NULL, verified_at TEXT NOT NULL
);
CREATE TABLE papers (
 id TEXT PRIMARY KEY, dblp_key TEXT UNIQUE, title TEXT NOT NULL, authors_json TEXT NOT NULL DEFAULT '[]',
 year INTEGER, doi TEXT, dblp_url TEXT, venue_id TEXT REFERENCES venues(id), venue_name TEXT,
 publication_type TEXT NOT NULL DEFAULT 'unknown', source TEXT NOT NULL CHECK(source IN ('ccf','personal')),
 bibtex TEXT, pdf_path TEXT, pdf_hash TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
);
CREATE INDEX papers_filter ON papers(source,venue_id,year);
CREATE UNIQUE INDEX papers_doi ON papers(doi) WHERE doi IS NOT NULL AND doi != '';
CREATE VIRTUAL TABLE papers_fts USING fts5(title, authors_json, venue_name, content='papers', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER papers_ai AFTER INSERT ON papers BEGIN
 INSERT INTO papers_fts(rowid,title,authors_json,venue_name) VALUES(new.rowid,new.title,new.authors_json,new.venue_name);
END;
CREATE TRIGGER papers_ad AFTER DELETE ON papers BEGIN
 INSERT INTO papers_fts(papers_fts,rowid,title,authors_json,venue_name) VALUES('delete',old.rowid,old.title,old.authors_json,old.venue_name);
END;
CREATE TRIGGER papers_au AFTER UPDATE ON papers BEGIN
 INSERT INTO papers_fts(papers_fts,rowid,title,authors_json,venue_name) VALUES('delete',old.rowid,old.title,old.authors_json,old.venue_name);
 INSERT INTO papers_fts(rowid,title,authors_json,venue_name) VALUES(new.rowid,new.title,new.authors_json,new.venue_name);
END;
CREATE TABLE paper_library_entries (
 id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id), project_id TEXT NOT NULL REFERENCES projects(id),
 folder TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, UNIQUE(paper_id,project_id)
);
CREATE TABLE annotations (
 id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id), project_id TEXT NOT NULL REFERENCES projects(id),
 page INTEGER, quote TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
);
-- Ideas, blueprints, stable modules, claims, paragraphs, figures, tables and venue profiles
-- share one identity/revision mechanism. Their structured payloads are validated in the service.
CREATE TABLE components (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL,
 name TEXT NOT NULL, data_json TEXT NOT NULL, revision_id TEXT, status TEXT NOT NULL DEFAULT 'draft',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX components_project ON components(project_id,kind);
CREATE TABLE revisions (
 id TEXT PRIMARY KEY, component_id TEXT NOT NULL REFERENCES components(id), parent_id TEXT REFERENCES revisions(id),
 data_json TEXT NOT NULL, content_hash TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX revisions_component ON revisions(component_id,created_at);
CREATE TABLE component_links (
 source_id TEXT NOT NULL REFERENCES components(id), target_id TEXT NOT NULL REFERENCES components(id),
 relation TEXT NOT NULL, PRIMARY KEY(source_id,target_id,relation)
);
CREATE TABLE experiments (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
 parent_id TEXT REFERENCES experiments(id), blueprint_revision TEXT REFERENCES revisions(id),
 git_commit TEXT, git_diff TEXT NOT NULL DEFAULT '', config_json TEXT NOT NULL, command_json TEXT NOT NULL,
 cwd TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 environment_json TEXT NOT NULL, metrics_json TEXT NOT NULL DEFAULT '{}', error TEXT,
 log_path TEXT, metrics_path TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX experiments_project ON experiments(project_id,created_at);
CREATE TABLE experiment_artifacts (
 id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id), path TEXT NOT NULL,
 sha256 TEXT NOT NULL, kind TEXT NOT NULL, UNIQUE(experiment_id,path)
);
CREATE TABLE evidence_links (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES components(id),
 experiment_id TEXT REFERENCES experiments(id), paper_id TEXT REFERENCES papers(id), component_id TEXT REFERENCES components(id),
 locator TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((experiment_id IS NOT NULL)+(paper_id IS NOT NULL)+(component_id IS NOT NULL)=1)
);
CREATE INDEX evidence_experiment ON evidence_links(experiment_id);
CREATE TABLE paragraph_outlines (
 paragraph_id TEXT PRIMARY KEY REFERENCES components(id), section TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '',
 main_claim TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '[]', connection TEXT NOT NULL DEFAULT '',
 references_json TEXT NOT NULL DEFAULT '[]', experiments_json TEXT NOT NULL DEFAULT '[]', locked INTEGER NOT NULL DEFAULT 0,
 pinned INTEGER NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE paragraph_evolution (
 id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES components(id), child_id TEXT NOT NULL REFERENCES components(id),
 operation TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE paper_versions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL, source_text TEXT NOT NULL,
 sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE agent_sessions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), thread_id TEXT UNIQUE, turn_id TEXT,
 role TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}',
 error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE agent_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES agent_sessions(id),
 event TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX agent_messages_session ON agent_messages(session_id,id);
CREATE TABLE skill_runs (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id), skill_name TEXT NOT NULL,
 skill_path TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL,
 input_json TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE reviews (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), scope_json TEXT NOT NULL, status TEXT NOT NULL,
 max_rounds INTEGER NOT NULL CHECK(max_rounds BETWEEN 1 AND 5), max_seconds INTEGER NOT NULL,
 round INTEGER NOT NULL DEFAULT 0, sessions_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE review_issues (
 id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id), session_id TEXT REFERENCES agent_sessions(id),
 severity TEXT NOT NULL, component_id TEXT REFERENCES components(id), experiment_id TEXT REFERENCES experiments(id),
 problem TEXT NOT NULL, evidence TEXT NOT NULL, suggested_fix TEXT NOT NULL, verification TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE submission_attempts (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), parent_id TEXT REFERENCES submission_attempts(id),
 venue_profile_id TEXT REFERENCES components(id), venue TEXT NOT NULL, branch TEXT NOT NULL,
 git_commit TEXT NOT NULL, snapshot_path TEXT NOT NULL, sha256 TEXT NOT NULL,
 manifest_json TEXT NOT NULL, submitted_at TEXT NOT NULL
);
CREATE TRIGGER immutable_submission_update BEFORE UPDATE ON submission_attempts BEGIN SELECT RAISE(ABORT,'Submission snapshots are immutable'); END;
CREATE TRIGGER immutable_submission_delete BEFORE DELETE ON submission_attempts BEGIN SELECT RAISE(ABORT,'Submission snapshots are immutable'); END;
CREATE TABLE submission_events (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submission_attempts(id), kind TEXT NOT NULL,
 data_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE import_jobs (
 id TEXT PRIMARY KEY, source_path TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
 processed INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
 errors_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
