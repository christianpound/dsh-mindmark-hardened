# Security boundaries and residual risks

## Scope

This fork hardens upstream dsh-mindmark 0.4.0 (`d3b30040a2a4a4218cca0dce52526b8cb342005c`). It is not a sandbox or an assurance that all vulnerabilities have been eliminated. A Host plugin runs with the DSH process's OS privileges. Installing any third-party plugin therefore grants significant trust.

## Transport

`/plugins/dsh-mindmark-hardened/annotations` calls DSH `connection.admit` on every request and only accepts the live authenticated browser-owner Peer, not API peers. Missing credentials fail closed. It additionally requires `x-dsh-mindmark: 1`, rejects OPTIONS, never emits CORS permission headers, rejects non-same-origin Fetch Metadata, and compares a supplied Origin with the actual Host and socket protocol. DSH admission also validates trusted authorities. Client requests use same-origin credentials and reject redirects.

There is no own token, login bypass or authentication downgrade. A custom header is a CSRF gate, not authentication by itself. Other code executing with your DSH page's origin, browser credential or OS account remains trusted and can access your data. This is not a multi-user access-control implementation: all browser connections authenticated as the DSH owner share owner authority. Unknown/not-open sessions are rejected before any state or global preference payload is returned.

## Global preferences

The model tool is `mindmark_annotations`. `distill` and `forget` ask the live root user's answerer for explicit confirmation, including the exact normalized additions or exact text to remove. No `always` approval exists. Skip, cancel, custom text, missing answerer and abort do not authorize mutation. Numeric removal indices are resolved before confirmation and removed afterward by exact text, never by a shifted index. Preference capacity must not silently evict old instructions.

The authenticated UI's remove-preference action is a direct human action. Model code cannot access it through the annotation tool without confirmation. This is not protection against another installed plugin or an agent already granted independent unrestricted filesystem/browser authority.

Global lessons use a separate managed block in the existing global instruction file. Upstream's block and all outside bytes are preserved. Comment delimiters are neutralized. Ambiguous/malformed managed blocks, file read failures and failed atomic replacement fail closed.

## Storage

The fork starts with separate `$DSH_HOME/annotations-hardened/` storage; no automatic upstream migration. New annotation IDs are server UUIDs. Reference paths combine a SHA-256 session identifier with the UUID; client IDs/selectors cannot select arbitrary files. Prototype-like map keys are handled as own data. Unknown annotation fields are discarded and per-item/session limits apply.

Data is plaintext, not encrypted. State and reference writes request owner-only permissions. A previous-state backup is retained. Deleting a mark removes its current reference file, but backups, filesystem snapshots, session logs, model-provider logs and prior exports can retain content. Deleting a DSH session does not automatically purge annotation storage. Use ordinary trusted backup/retention controls; do not interpret UI deletion as secure erasure.

## Model/provider disclosure

The full workflow deliberately sends pending annotations and relevant sources to the configured model provider. Brief mode limits injected context, **not** storage: selected answer bodies can still be captured. Large sources are excerpted and available to the model in chunks. URL sources are not automatically fetched by this plugin, but the model may read them using its own tools.

The prompt explicitly labels quoted answers, links and reference materials as untrusted task data; they cannot authorize secret access, external transmission, tool execution or persistent preferences. This is defense in depth, not a proof against prompt injection. Keep DSH tool permissions restrictive and do not attach secrets unless you intend the model/provider to see them.

## Client

Every mounted session owns its own controller, asynchronous work and highlighting namespace. Anchors require explicit session and message ownership; missing or ambiguous anchors fail closed. File completions require the original draft token, generation and file kind, preventing cancelled/replaced or out-of-order reads from attaching to another draft. Server IDs reconcile queued optimistic operations.

These checks depend on current DSH DOM ownership attributes. Upgrades need re-verification. The fork preserves upstream selection UI and CSS Highlight rendering, not a replacement application.

## Reporting and updates

Report issues to the fork owner. Do not include secrets or private session logs in public reports. Pin a reviewed commit when deploying. The local install is linked to its workspace checkout: later file changes can affect future loads and should be reviewed. Never run upstream and this fork simultaneously in one profile.
