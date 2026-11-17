# Validation record

Environment: DSH Web 0.2.2-rc.1; Node built-in test runner. Upstream baseline: d3b30040a2a4a4218cca0dce52526b8cb342005c.

## Automated checks

- **86 tests passed**, zero failures/skips, using `node --test test/*.test.mjs`.
- JavaScript syntax checks for Host and Client; `git diff --check` passed.
- `npm pack --dry-run --ignore-scripts --json` confirmed 17 expected distributed files and no dependencies/lifecycle scripts.
- Upstream regressions plus added Host security, storage isolation, managed-marker and file/session race tests.
- Host tests mock Connection admission; they test the plugin's handling of admission/rejection, not DSH's cryptographic credential implementation.
- Client tests execute helpers in a VM with controlled file/DOM fixtures. These are behavioral regression tests, not browser visual verification.
- Independent read-only review identified additional preference-budget and state-read data-loss paths; both were fixed and regression-tested before installation.
- MIT license, exported locales/icon and package file list reviewed.

## Live verification

Installed through the DSH plugin manager into the existing Web profile. Result: `application: applied`, enabled, version `0.4.1-hardened.1`, no application warnings. The package manager separately emitted a generic peer-dependency warning; runtime registration succeeded.

Confirmed in the already connected Web client:
- Active hardened selection surface and Quote replacement registration.
- Active annotation mode control in the composer.
- Active session-header annotation button.
- `mindmark_annotations` callable in the current session; read-only list returned no annotations.

Actual requests to the existing `http://127.0.0.1:3080` route without credentials returned 401; `Origin: null` and unrelated localhost origin returned 403, all without CORS permission headers. No browser credentials were extracted or bypassed.

No screenshot or real-browser interaction test has been performed. Actual highlight selection, light/dark appearance, authenticated browser mutation, and the human approval dialog still require interactive verification. Slot registration is not proof of rendered visual correctness.

## Residual limitations

See [SECURITY.md](<SECURITY.md>). In particular, model/provider disclosure remains intentional, prompt injection cannot be ruled out, and annotation persistence is separate from session-log retention. Annotation writes retain upstream best-effort persistence behavior on disk failures; protect storage availability and backups. Global instruction writes and unreadable/corrupt state loading fail closed.
