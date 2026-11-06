# EasyRef Research Schema extension profile

Protocol version: 1.0.0. This is an application extension, not a published or registered RO-Crate profile.

A package MUST contain research.yaml, handoff.yaml, history/events.jsonl and ro-crate-metadata.json. Exported packages MUST contain checksums.json. research.yaml MUST validate against research.schema.json (JSON Schema 2020-12). All text MUST be UTF-8. Local paths MUST be normalized relative paths without traversal, drive letters, alternate streams, reserved Windows names or symlinks. IDs MUST survive file moves and text edits. UUIDs are generated for new objects; existing opaque stable IDs are accepted.

The metadata descriptor MUST identify itself as ro-crate-metadata.json, have type CreativeWork, refer to the root Dataset with about, and declare https://w3id.org/ro/crate/1.3. The root MUST have name, description, datePublished and license. An unspecified license is represented by a descriptive CreativeWork; this does not grant redistribution rights.

EasyRef terms use the explicit urn:easyref:terms: namespace. er:profile points to this bundled document. No public profile URI is invented. Publishing a permanent resolvable profile URI and registering a Profile Crate remain separate release work. All object types include a Schema.org CreativeWork fallback. Canonical research facts live in research.yaml; JSON-LD is generated, never edited independently.

ExperimentRun, SkillRun and AgentSession are PROV Activities. Other research objects are PROV Entities. Only entity→entity derived_from, activity→entity uses/produces and entity→activity generated_by map to prov:wasDerivedFrom, prov:used, prov:generated and prov:wasGeneratedBy. All other relations retain er: semantics. A session is an activity, not the identity of an autonomous person or software agent. Recorded actor strings are source attribution; this implementation does not invent identified prov:Agent entities from those strings.

supports and contradicts require explicit Evidence references and cannot be automatically asserted. A support edge alone MUST NOT change validation_status. A verified claim requires successful checks naming the reviewer and evidence with a traceable fingerprint. completed tasks require verification records. Imported running activities MUST be treated as interrupted; a research context or task plan MUST NOT be described as a restored process.

Event histories are append-only hash chains. Corrections MUST be new events. Hashes detect corruption and modification relative to the supplied manifest; they are not cryptographic authentication of an author. Schema migration MUST preserve IDs and unknown extensions. Unknown protocol versions MUST fail closed.
