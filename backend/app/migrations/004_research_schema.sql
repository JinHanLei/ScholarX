CREATE TABLE research_checkpoints (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 document_hash TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
