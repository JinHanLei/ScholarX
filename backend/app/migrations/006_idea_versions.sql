CREATE TABLE idea_documents (
 idea_id TEXT PRIMARY KEY REFERENCES components(id), project_id TEXT NOT NULL REFERENCES projects(id),
 blueprint_id TEXT NOT NULL REFERENCES components(id), revision INTEGER NOT NULL DEFAULT 0,
 document_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE idea_versions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), idea_id TEXT NOT NULL REFERENCES components(id),
 number INTEGER NOT NULL, blueprint_revision TEXT NOT NULL REFERENCES revisions(id),
 idea_revision TEXT NOT NULL REFERENCES revisions(id), document_json TEXT NOT NULL, semantic_hash TEXT NOT NULL,
 purpose TEXT NOT NULL, stage TEXT NOT NULL, message TEXT NOT NULL, workspace TEXT,
 session_id TEXT REFERENCES agent_sessions(id), plan_json TEXT NOT NULL DEFAULT '{}',
 manifest_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,number)
);
CREATE INDEX idea_versions_queue ON idea_versions(project_id,stage,number);
CREATE TABLE idea_version_runs (
 project_id TEXT NOT NULL REFERENCES projects(id), version_id TEXT NOT NULL REFERENCES idea_versions(id),
 experiment_id TEXT NOT NULL UNIQUE REFERENCES experiments(id), position INTEGER NOT NULL,
 PRIMARY KEY(version_id,experiment_id)
);
CREATE TABLE idea_version_events (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), version_id TEXT NOT NULL REFERENCES idea_versions(id),
 stage TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE idea_active_context (
 id INTEGER PRIMARY KEY CHECK(id=1), project_id TEXT NOT NULL REFERENCES projects(id),
 idea_id TEXT REFERENCES components(id), updated_at TEXT NOT NULL
);
