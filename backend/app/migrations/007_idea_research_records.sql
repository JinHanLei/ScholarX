CREATE TABLE idea_research_records (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 idea_id TEXT NOT NULL REFERENCES components(id),
 version_id TEXT REFERENCES idea_versions(id),
 based_on_version_id TEXT REFERENCES idea_versions(id),
 document_revision INTEGER NOT NULL,
 document_json TEXT NOT NULL,
 data_json TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idea_research_records_history ON idea_research_records(idea_id,created_at);
