# MindMark hardened

A security-focused fork of [BaiKe-Zhang/dsh-mindmark](https://github.com/BaiKe-Zhang/dsh-mindmark), based on upstream 0.4.0 at `d3b30040a2a4a4218cca0dce52526b8cb342005c`. Original MIT copyright and icon attribution are retained. This is not an official DeepSeek plugin or a guarantee of security.

**This preserves the full annotation workflow, not local-only highlighting. Pending annotations and attached sources enter your next model turn.** See [SECURITY.md](<SECURITY.md>) for boundaries, provider disclosure, storage retention and limitations.

## Features

Select part of an assistant response to **Quote, Highlight, Underline, Strike, Comment, Rewrite, attach a Source, or Move**. The existing Quote action is preserved. Use the session header marker button to review/delete annotations, mark them handled, or reopen them. The composer switch selects Brief or Full model context.

- Comment/Rewrite: enter text and confirm, or Ctrl+Enter.
- Source: paste text or a URL, or select a plain-text file. Confirm before uploading. Long materials are read in chunks by the model.
- Move: Alt+C picks up a selection; choose a destination in the same answer; Alt+V drops it. Escape cancels. A selected destination is replaced.
- On your next turn, pending annotations are injected and the model uses `mindmark_annotations` to resolve them. Unresolved marks settle after three injections by default.
- **Keep as habit** asks the agent to propose persistent preferences. Each model-requested save or removal prompts for separate human approval of the exact text. Cancel, skip, missing answerer, or abort cannot authorize a write. Removing a displayed preference directly in the authenticated UI is a user action.

## Hardening

- DSH Connection admission and authenticated browser-owner identity; same-origin custom-header requests only. No CORS grants or anonymous API fallback.
- Existing open sessions required; reference files use session hashes and server UUIDs.
- Separate annotation data namespace and separate managed instruction block. No automatic upstream data import.
- Session-owned UI controllers, message-bound anchors, stale file/draft guards, queued-ID reconciliation.
- Managed-block delimiter neutralization; exact-text removal after approval; fail-closed global instruction reads and atomic replacement.
- Explicit untrusted-reference boundary in model context. Repeated annotations do not authorize persistent preferences.
- No dependencies, lifecycle scripts, telemetry, external frontend resources, or automatic URL fetching.

## Install

Requires DSH Web with the Connection admission API, tested against **0.2.2-rc.1**. Disable the upstream MindMark first: both replace the same selection surface.

```sh
dsh plugin --profile web add github:christianpound/dsh-mindmark-hardened
```

For a local checkout, use the plugin manager with its absolute directory. The package name is `@local/dsh-mindmark-hardened`; the row is `dsh-mindmark-hardened`. It is private to prevent accidental npm publication. No build/install scripts are needed. Refresh the existing DSH page after installation. Package upgrades may require a DSH restart as reported by the plugin manager.

Configuration remains `defaultMode: brief | full` (default brief) and `maxInjections` (default 3). No switch disables authentication or approval.

## Storage and privacy

Annotations and captured answers: `$DSH_HOME/annotations-hardened/state.json` with a previous-state backup. Materials: the adjacent `materials/` directory. Files are not encrypted. Global preferences: a separate `dsh-mindmark-hardened` managed block in `$DSH_HOME/AGENTS.md` (or `~/.dsh` when `DSH_HOME` is unset).

Brief mode limits model injection, **not** answer capture/storage. Deleting sessions does not purge annotation storage. Previously injected content remains in session logs and may already have reached your model provider. Review [SECURITY.md](<SECURITY.md>) before annotating secrets.

## Verification

```sh
node --check index.js
node --check client.js
node --test test/*.test.mjs
git diff --check
```

Tests cover authentication/origin gates, human approval, session material isolation, marker injection, file races, session anchors and upstream functionality. Browser visual verification is separate from tests; see [VALIDATION.md](<VALIDATION.md>) for the verification record.

## Compatibility limits

Anchoring depends on DSH's `data-conversation-session`, `data-chat-node-key`, and text-interaction source attributes. Missing/ambiguous boundaries fail closed instead of highlighting another message. Multi-selection overlays may coexist, but reference and move operations remain message-local. Reverse proxies must preserve same-origin authenticated browser requests; opaque-origin desktop shells and API peers are intentionally not accepted. No automatic migration from upstream.

## License

MIT; original copyright (c) 2026 BaiKe-Zhang. Upstream history and [LICENSE](<LICENSE>) are retained. Fork changes are distributed under the same terms.
