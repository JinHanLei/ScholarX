ALTER TABLE paper_library_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
ALTER TABLE paper_library_entries ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));
CREATE INDEX library_project_state ON paper_library_entries(project_id,archived,pinned);
