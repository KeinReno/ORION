# ADR-0049 — Knowledge collections and optional project links

Status: Accepted for the owner-requested Knowledge 2.0 implementation, 2026-11-09.

Knowledge is a workspace library first. Categories act as collections and may contain uncategorized items; neither a category nor a project is required to create or keep a material. A material may reference one project through nullable `KnowledgeItem.projectId`. The API validates that reference with the public Projects `ProjectReferences` contract in the same transaction. Knowledge does not import Projects internals. Project deletion clears the reference and keeps the library item.

When Projects is enabled, the Knowledge context editor offers an optional project selector and the project Materials view lists linked Knowledge items. When Projects is disabled, the library remains usable and the stored reference is retained. Existing materials migrate with `projectId = NULL`.

URL sources remain separate from editorial text. Uploaded files and extracted ZIP contents are stored through Documents and linked as Knowledge sources, so storage and file permissions remain Documents-owned. Folder paths are retained. ZIP entries with unsafe paths are rejected. Other archive formats are not extracted by this first implementation.

UI direction: collection tree, searchable/sortable material list, and a working editor/reader area; narrow panels collapse to a single content view. This does not redefine Notes or Documents and does not copy material into a project.
