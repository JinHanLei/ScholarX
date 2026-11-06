-- Keep the initial library page responsive after importing millions of records.
CREATE INDEX papers_source_year_title ON papers(source,year DESC,title);
CREATE INDEX papers_source_title ON papers(source,title);
