# Transit end-to-end tests

This suite exercises the unchanged application in a real headless Chromium browser. It tests a fixed pre-PR18 baseline, current upstream `main`, and PR #18's head, records their exact commit IDs, and keeps actual defects as failing tests. No API keys, paid services, Docker, user browser profiles, or production writes are required.

## Run locally

Use Node 24 LTS, npm, Git, Python 3, and `tar`. Windows includes `tar`; Linux needs Chromium system libraries. Playwright's documented Linux dependency installation is also performed on the disposable GitHub runner. Start in the repository root.

```text
node tests/run.mjs setup
node tests/run.mjs check baseline
node tests/run.mjs check main
node tests/run.mjs check pr18
```

`setup` installs the locked test tooling and Chromium, then fetches the two upstream refs. To update only the comparison targets, run `node tests/run.mjs refresh`. The check commands copy the selected commit into an owned temporary directory under `tests/`, install that snapshot's locked application dependencies, and start Express on an ephemeral loopback port. They preserve evidence in the existing `review/evidence/` surface and remove runtime state even when tests fail. They never check out another branch or launch a visible window.

For three independent executions of each case, run `node tests/run.mjs check pr18 repeatedly` (or substitute `main`). Repetition does not turn failures into passes; retries remain disabled.

The same fixtures, clock, asset versions, desktop dimensions, and browser instrument are used on all targets. `baseline` is pinned to `e0183aac2428c7d92f9dcb35a09f46c304e86fda`. The six cases introduced by PR18 are skipped only on that baseline; current `main` runs them after PR18's merge. Aggregate pass counts have different denominators and are not a measure of relative quality. `target.json` records the source SHA, capability setting, runtime, fixture hash, and tooling lock hash. The JSON report also records the Playwright version. `main` and `pr18` can contain identical application code after the merge; the fixed baseline preserves the pre/post comparison.

## Coverage

- Real page startup, route geometry, visible stops, alerts, and About controls.
- Desktop 1440×1000, short desktop 1000×500, and touch/mobile Chromium 390×844. Mobile emulation does not add a viewport meta tag to the app.
- PR18 exact stop search, real stop/bus cards, error presentation, delayed-request closure, and Express mapping an upstream prediction HTTP 503 to HTTP 502.
- Twelve repeated route/stop cycles and twelve searched-stop card cycles. Layer counts compare identical completed states after Leaflet initializes its shared renderer. These catch growing map-layer retention, not every kind of memory leak.
- Uncaught JavaScript exceptions, startup console errors, and unexpected external browser requests fail explicitly. Console errors from intentionally injected HTTP failures are retained as diagnostics.

The bounded fixture derives from the retained November 4 observations in `review/evidence/`. It includes all route/stop metadata, four selected trips and their geometry/times, three matching vehicles/updates, and one alert. Its source hashes and selection are embedded in `fixtures/transit.json`. `support/derive-fixture.py` reproduces the derivative if the original corpus is available; ordinary runs only need the committed derivative.

The real Leaflet/MapLibre/Bootstrap scripts and CSS are pinned to the app's SRI versions and served from npm packages at their original URLs. A minimal local MapLibre style supplies the layer IDs the app edits. Font bytes are local. External requests fail closed. The map renderer runs, but real basemap labels, satellite tiles, CDN availability, and production feed freshness are outside this deterministic suite.

Reports include JSON/HTML, screenshots and traces for failures, browser console/exception logs, server stdout/stderr, upstream replay request timing, and sampled server memory/CPU/active resources. These samples support diagnosis; they have no uncalibrated performance threshold. Raw observation files remain at their original fidelity. Each invocation has one temporary base; owned child processes are stopped before cleanup. Shared tooling provenance: replay strategy from `review/server-probe.cjs`, capture contract vendored unchanged from Jason's `capture_manifest.py`, UA normalization function copied from `web_session.py`.

## Production checks

```text
node tests/live.mjs
node tests/live-browser.mjs
```

The HTTP smoke check makes six public GET requests: HTML, JavaScript, CSS, routes, vehicles, and alerts. It checks response shapes, initialized routes, and finite vehicle coordinates. Empty vehicle/alert arrays are legitimate. It does not prove freshness, browser rendering, or prediction correctness.

The optional live browser check loads production with the actual CDN/map/feed dependencies and opens/closes About. It retains a screenshot, trace, application-origin response bytes, and a capture manifest. External responses are enumerated; the structured corpus does not claim to retain all external bodies. Production deployment identity is unknown, so this is not the pinned pre/post comparison. Both live checks only observe public resources.

## Fork CI

The workflows are restricted to `jnguyen1098/guelph-transit-map`. They have `contents: read`, no secrets, no pull-request trigger, one browser worker, zero automatic test retries, and bounded job/artifact retention. Product failures intentionally make the nightly job red.

- **Nightly transit tests**: 03:17 in `America/Toronto`; serial `baseline`/`main`/`pr18` matrix; seven-day evidence retention; 20-minute job limit.
- **Hourly transit smoke**: minute :37 in `America/Toronto`; six production HTTP GETs; two-day evidence retention; five-minute job limit.
- Manual dispatch and relevant pushes to fork `main`/`jason` are supported. Scheduled workflows must be on the fork's default branch and Actions must be enabled. GitHub schedules can be delayed or dropped, and public repositories can have schedules disabled after 60 days of inactivity.

No workflows are installed in BenFort's repository. GitHub-hosted execution, permissions, artifact upload, and real cron delivery must be verified after publishing; a local lint or Linux run does not prove those capabilities. The authorized temporary five-minute cadence has not been applied while fork write access is unavailable.
