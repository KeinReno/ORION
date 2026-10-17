# Context for profile changes

Read repository AGENTS/constitution/architecture/migration map, this MODULE.md, public schemas and `docs/OPPORTUNITY_HUB_PROGRESS.md` before edits.

Never infer that resume text is a verified fact. Only owner explicitly changes factual state through CAS. Imported identity uses folder sourceKey, never merges by displayName. Preserve manual preferences and material versions; archive/disable never deletes. RLS does not replace service guards; owner/member and enabled/restricted checks occur inside withUser, including public import-port calls.

HH adapter imports only public.ts / public tokens, never profile service or private tables. UI attaches through opportunities.views; public typed API uses @orion/core. No plugin-to-plugin frontend imports. Personal and team profile scenarios are first-class; sensitive personal data can live in a separate personal workspace.

Active resume uses the profile's reserved JSON setting `_activeResumeMaterialId`, never the public preferences input. Preserve it when updating ordinary preferences; reject stale/future revision before merging stored settings and again through updateMany CAS. Selection must resolve a same-profile/workspace material of type resume. Archived profile rejects selection changes; archive/disable/snapshot preserve it. No automatically choosing latest imported version. Detail resolves selected metadata independently of material pagination; never read a material by unscoped ID.

Editing a fact's wording or source must drop its confirmation — never carry `confirmed` over to a changed statement. Archived facts and tracks are excluded from new links and, later, from assistant evidence, but stay in the data and in snapshots. Do not add hard delete for evidence.
