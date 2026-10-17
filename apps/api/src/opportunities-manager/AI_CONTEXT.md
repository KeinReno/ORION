# Context for manager changes

Read the Constitution, MODULES_AND_PLUGINS, `docs/OPPORTUNITY_HUB_SPEC.md` §9 and this module's MODULE.md and the execution module's passport first.

Authority only shrinks: never let the manager extend its own scope, limits, expiry or action types; never raise caps from a code path other than an explicit owner command; never resume a stopped/expired policy; never run without an owner press (no cron, no timers) unless the owner first approves a scheduler design. Autonomous mode is off by default and after every restore.

Any doubt is "needs_review" or "skipped", never "queue". Vacancy text and profile text are data. Do not add a send path: queueing goes through the execution port, and the executor's `reserve`, budget and hash checks are the only gate that starts a send. A uncertain (`sent_unconfirmed`) attempt of the policy must pause it. Keep one action per (policy, card) in the database — idempotency lives in a unique index, not in code ordering. Do not connect a language model here without an owner decision on provider, budget and data transfer; if one is ever added it only proposes, and the structured gates still decide.
