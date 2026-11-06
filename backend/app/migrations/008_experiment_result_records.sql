CREATE TABLE experiment_result_records (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 experiment_id TEXT NOT NULL REFERENCES experiments(id),
 kind TEXT NOT NULL CHECK(kind IN ('mapping','note')),
 data_json TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX experiment_result_records_run ON experiment_result_records(experiment_id,created_at);
