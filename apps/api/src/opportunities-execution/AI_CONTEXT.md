# Context for execution changes

Read the Constitution, MODULES_AND_PLUGINS, `docs/OPPORTUNITY_HUB_SPEC.md` §6, §9, §10 and this module's MODULE.md first.

Never send for real without the owner's explicit permission for the concrete account and action. Do not write or run a live hh.ru browser script in this repository without that permission; do not import scripts from the HH folder; do not bypass CAPTCHA or platform protections — a person-required step stops the job (`needs_user_action`) with a visible reason.

Invariants you must not weaken: (1) the only way to start a send is `reserve → proceed:true`, and it takes the budget and consumes the grant atomically; (2) after `reserve` every uncertain outcome is `sent_unconfirmed`, never "not sent", never retried; (3) a grant is bound to `payloadHash` and is re-verified at approve, claim and reserve against the CURRENT dry run; (4) confirmation needs evidence bound to account + recipient + time; (5) rights, plugin state and connection state are re-checked on every runner call; (6) secrets are hashes only and never reach a backup; (7) restore never revives the queue or a link.

New action types (message reply, resume update) need their own payload, grant scope, evidence rules and tests — do not reuse `apply` semantics. The autonomy layer must go through the same `reserve` checkpoint and the same budget; it adds policy, not another send path.
