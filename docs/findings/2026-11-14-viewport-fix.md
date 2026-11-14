# Mobile viewport fix and before/after video

Jason requested a before/after video of the viewport fix. The local candidate is on `codex/mobile-viewport-fix`, at `dcc322ad72026a7d942ac295ef8dbd8725c7687c`, in `.review-worktrees/mobile-viewport-fix/`. It adds device-width/initial-scale metadata, a narrow-screen CSS layout for touch controls, route buttons, search/cards, alerts and About, and adjusts mobile bus-marker sizing for an unscaled viewport. Desktop styling remains outside the responsive media condition. The branch is local and no viewport PR or merge was performed during this request.

The before snapshot is `79945ba65a3e0e44c29843939a82a25b963250a9`, the header-script fix from PR19. Both recordings therefore include that same header fix; their application differences are the viewport/mobile changes. The local candidate builds on PR19 rather than adding anything to PR19 itself.

## The same mobile workflow was recorded on both revisions

Adopted Playwright's existing built-in video recorder instead of building a recorder. Both versions use the same Chromium 156.0.8078.4, Playwright 1.64.1, Node v24.22.3, 390×844 CSS-pixel emulation, device pixel ratio 1, coarse pointer/touch, user agent, Toronto timezone, en-CA locale, transit fixture and fixed date. `recording-protocol.json` verifies equality of the recorded instrument fields. The fixed feed SHA-256 is `7fb59ee8bc98084baefd46d240b24b36e04b71867e223002365b000ff71407c9`; the test tooling lock SHA-256 is `e57bd146d4c20abf32f976905fc1bcdb717d84dbcacbc65d5ff0129885d693d7`.

The page runs real Express, Leaflet and MapLibre. Transit responses are replayed; the real OpenFreeMap basemap and location icon are supplied through a shared anonymous asset cache keyed by original URL and checked SHA-256. Shared asset URLs use identical bytes. Different tile coverage follows from the changed layout viewport; this is a layout/interaction comparison, not a network-load or rendering-performance benchmark. No map zoom setting was changed.

Both recordings select route 99 North, show its stops, search stop 103, open and close its arrival card, open and close About, and open and close service alerts. The same actions start at scheduled elapsed times, with actual timestamps retained. Each action uses visible browser controls and real touch input, without force-clicks. Both runs completed with zero browser errors and no unhandled external requests.

The before layout reports 980px wide and visual scale approximately 0.398. The after layout reports 390px wide, scale 1 and no horizontal document overflow in the recorded initial, card and About states. The after About dialog spans x=12 to x=378; primary controls are 44px tall. A metadata-only probe had already demonstrated the narrower viewport while leaving About 640px wide and controls overlapping; the responsive CSS addresses those observed issues.

## Videos and original evidence are retained

All evidence is under `review/evidence/viewport-video-2026-11-14-1794677414640/`:

- `comparison.mp4`: 34-second side-by-side H.264 video, 780×900, before on the left and after on the right. Labels occupy an added strip above the original viewport images.
- `before.mp4` and `after.mp4`: individual H.264 clips at 390×844.
- `before-video-1794677949570/` and `after-video-1794678046987/`: original native WebM recordings, JSON measurements, screenshots, browser/server diagnostics, full observed HTTP response bodies, closed-session capture manifests and instrument/step metadata.
- `asset-cache/`: original fetched basemap/icon bodies and their URL/status/type/digest metadata, retained at full fidelity.
- `recording-protocol.json`: exact capture source and instrument comparison; `media-derivatives.json`: original source paths, FFmpeg version/arguments, sizes, SHA-256 values and decode results.

The MP4 clips trim the first eight seconds of initial loading/waiting from each original and retain the next 34 seconds at original speed. Original WebMs are not overwritten. Each MP4 was fully decoded by FFmpeg without errors; codec, dimensions and duration were checked with ffprobe. Extracted frames at the initial map, arrival card and About were visually inspected. Both video capture manifests validate with bounded coverage and unknown exhaustion: 75 recorded observations before and 44 after. The stated scope is the controlled session, not all possible workflows or public feed freshness.

Earlier probe attempts remain intact. The first exited before browser navigation because the inline Node launcher passed an incompatible argument to its child; later probes corrected the child launch. One probe labelled `after` still used metadata-only SHA `4ef48cc`; exact instrument SHAs distinguish it from the final candidate. Neither attempt is counted as final candidate verification. No raw captures were deleted or replaced.

## The existing browser suite passes on the candidate

Executed the unchanged full suite against an archive of exact candidate `dcc322a` using the existing fixed replay setup. Output: `12 passed (1.1m)`, zero failed, skipped or flaky cases. This covers desktop startup without console errors, rider workflows, prediction/error/race cases, repeated interactions, short-desktop controls and the original 390px mobile viewport assertion. Reports and diagnostics are in `review/evidence/viewport-fix-after-2026-11-14T17-42-35-090Z/`.

The local `jason` checkout is preserved. Candidate source changes are committed in its isolated worktree; this document records the handoff in the main checkout. Temporary application copies, anonymous browser profiles and owned server processes were cleaned up. The videos provide a concrete local result for Jason's UI review before any further publication.

## Inspection limits

VERIFIED by execution: both actual browser recordings, matching instruments/fixtures, successful visible interactions, the stated width/dialog/control measurements, validated capture manifests, full MP4 decoding, and all twelve existing browser tests. VERIFIED by reading/visual inspection: candidate source, exact diff, and representative encoded video frames. This was headless Chromium with controlled feeds and cached basemap assets, not a physical phone, production deployment, soft-keyboard test or performance benchmark. Other mobile dimensions/orientations and browser engines were not executed in this request; broader usability remains unverified.
