# Context for profile changes

Read repository AGENTS/constitution/architecture/migration map, this MODULE.md, public schemas and `docs/OPPORTUNITY_HUB_PROGRESS.md` before edits.

Never infer that resume text is a verified fact. Only owner explicitly changes factual state through CAS. Imported identity uses folder sourceKey, never merges by displayName. Preserve manual preferences and material versions; archive/disable never deletes. RLS does not replace service guards; owner/member and enabled/restricted checks occur inside withUser, including public import-port calls.

HH adapter imports only public.ts / public tokens, never profile service or private tables. UI attaches through opportunities.views; public typed API uses @orion/core. No plugin-to-plugin frontend imports. Personal and team profile scenarios are first-class; sensitive personal data can live in a separate personal workspace.
