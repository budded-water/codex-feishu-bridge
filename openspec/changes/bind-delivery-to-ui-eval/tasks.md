# Tasks

- [x] Reuse the existing delivery checkpoint to bind a passing Web verification report.
- [x] Verify private-owner access, exact matching, repeat confirmation, restart and evidence drift at confirmation and Worker startup.
- [x] Exercise the Provider login-controls suite in an isolated local checkout.
- [ ] Run required checks and independently review the current candidate.
- [ ] Record any separately authorized managed deployment and live acceptance.

The local Provider diagnostic ran its pinned UI-eval engine and actual Chromium
against loopback fixtures. The JSON and HTML reported pass for login controls.
The same probe reopened the admission database, refused a modified report,
admitted one confirmation and resumed the original thread through a scripted
Codex backend with synthetic Feishu transport and Hub dispatch.
