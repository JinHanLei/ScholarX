CREATE TABLE outline_versions (
 id TEXT PRIMARY KEY,
 paragraph_id TEXT NOT NULL REFERENCES components(id),
 data_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX outline_versions_paragraph ON outline_versions(paragraph_id,created_at);
ALTER TABLE submission_attempts ADD COLUMN snapshot_kind TEXT NOT NULL DEFAULT 'prepared' CHECK(snapshot_kind IN ('prepared','submitted'));
