CREATE TABLE experiment_tracking (
 id TEXT PRIMARY KEY REFERENCES experiments(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 data_json TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX experiment_tracking_project ON experiment_tracking(project_id);
