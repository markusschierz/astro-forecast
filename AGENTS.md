# Astro Forecast: agent instructions

## Project and source of truth

- Work in markusschierz/astro-forecast; read README.md and docs/ARCHITECTURE.md before changing behavior. Deployment setup is in docs/GITHUB-SETUP.md.
- This repository contains the webapp, PHP proxies, tests and deployment scripts. Keep them together; do not introduce separate repositories or clients without a request.
- Preserve existing features and design unless the requested change requires otherwise.

## Version branches and release process

- Develop each release on develop/<next-version>, currently develop/3.11, starting from the current test branch. Group the release's related changes there.
- Changes to application behavior or display update the visible version and service-worker cache together. Documentation, tests and infrastructure alone do not bump the app version.
- Submit development changes by PR into test. Never push directly to test or main.
- A merge into test automatically runs validation and deploys to https://test.astro-foto.ch/astro-forecast/.
- Wait for a successful test deployment. Markus performs the visual review before production promotion.
- Promote the reviewed content by PR from test into main. Markus's merge is the production approval; do not merge a production PR without explicit authorization.
- main automatically deploys to https://astro-foto.ch/astro-forecast/. Production must match the full Git tree of a successful test deployment, even when the merge commit SHA differs. Never bypass this verification.
- Freeze test during visual review and promotion. After promotion, bring main back into test through a PR to maintain shared history.
- Keep main and test permanently. Version branches may be removed after their changes are incorporated and the release is complete.

## Agent roles

The main agent coordinates the task and owns the final result. Delegate bounded independent tasks when a substantial change benefits from specialist review. Small changes do not require multiple agents. Role names below describe responsibilities; this file does not install persistent agents.

### Coordinator

- Establish requirements, current refs and scope; assign clear work boundaries; integrate findings and resolve disagreements.
- Keep implementation changes on the version branch. Report code state, automated verification, test deployment and production deployment separately and truthfully.

### Developer

- Implement the requested frontend, forecast logic or PHP proxy change; preserve the established score gates and data handling unless explicitly changed.
- Run relevant syntax and regression checks. Report changed behavior and limitations.
- Do not merge or publish production.

### Reviewer

- Independently review the actual diff for forecast regressions, unknown weather data, cloud/fog/precipitation gates, version/cache consistency and missing meaningful tests.
- Return findings with evidence and severity. Review is read-only unless the coordinator assigns a specific fix.

### Release

- Inspect workflow configuration, successful runs, exact tested content and public deployment verification. Diagnose failed jobs without exposing secrets.
- Prepare development-to-test or test-to-main PRs as appropriate. Run selection is automatic; do not ask for a manual test run ID.
- GitHub Actions performs deployment. Agent roles do not grant new connector capabilities or bypass repository/environment rules or human production approval.

## Verification and editing boundaries

- JavaScript: npm run check:js and npm test.
- Python: python3 -m unittest discover -s tests -p 'test_*.py'.
- PHP: lint api/7timer.php, api/meteoblue.php and api/config.example.php with php -l, locally when available and in GitHub Actions.
- The baseline CI check must pass. Distinguish executable passing tests from TODOs, and local checks from hosted checks.
- Avoid parallel agents editing the same files. Parallel work is best used for investigation and independent review; integrate edits sequentially.
- Never commit credentials, server configuration secrets or API keys. Preserve server-only config and the existing deployment allowlist.
