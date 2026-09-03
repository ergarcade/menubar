# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

An Electron menu-bar app for macOS showing live [Concept2 PM5](https://www.concept2.com/indoor-rowers/performance-monitors)
metrics. Built on [`pm5-base`](https://github.com/ergarcade/pm5-base) (a
git submodule at `pm5-base/`) — all PM5 protocol/transport code
(`pm5-base/lib/*.js`) is used unchanged, since Electron's renderer supports
both Web Bluetooth and WebHID natively. See `pm5-base/CLAUDE.md` for how
those transports and `pm5fields` work; nothing here reimplements any of it.

## Layout

```
main.js           Electron main process: Tray (text title, no icon asset) +
                   a popover BrowserWindow, plus the select-bluetooth-device /
                   select-hid-device handlers Electron requires for the
                   device pickers to work at all
preload.js         contextBridge: exposes window.trayBar.setTitle() so the
                   renderer (contextIsolation'd, no nodeIntegration) can push
                   its headline metric up to the Tray
renderer.html/.js  loads pm5-base/lib/*.js via plain <script> tags (same
                   load order as pm5-base/example/index.html) and mirrors
                   its app.js connect/disconnect flow, but renders only a
                   curated field subset (ROWS in renderer.js) instead of
                   pm5-base's full per-event-type card grid
test/              node tests for renderer.js's pure field-fallback logic
```

## Adding a displayed field

Add an entry to `ROWS` in `renderer.js` — `keys` lists the field's possible
names across transports (BLE name first, then HID's, matching how
`pm5-base/lib/pm5-fields.js` names them); `pickField` picks whichever one the
connected transport actually reports.

## Window lifecycle and memory

The popover window is built **on demand** (first tray click) and destroyed
again once it's both hidden and not holding a connection, so an idle app in
the menu bar costs no loaded renderer. `releaseIfIdle()` in `main.js` is the
one place that decides; it's gated on `keepAlive`, which the renderer sets
via `trayBar.setKeepAlive()` from `cbConnecting` (**not** `cbConnected` —
an OS Bluetooth prompt stealing focus would otherwise blur the popover and
release the window mid-handshake) and clears in `cbDisconnected`. It also
refuses to destroy a *visible* window, so clicking Disconnect doesn't make
the panel vanish under you; the teardown happens on the next blur instead.
The destroy is deferred with `setImmediate` so a window is never destroyed
from inside its own event handler.

This makes `app.on('window-all-closed', () => {})` load-bearing: merely
*having* a listener is what suppresses Electron's quit-on-last-window-closed,
which now fires for real every time the popover is released. Empty body, on
purpose.

Measured physical footprint (`vmmap --summary`, not `ps` RSS — RSS reports
~380MB for the same app because it double-counts shared Chromium pages):

| state | footprint |
|---|---|
| idle, before these changes | ~84 MB |
| idle, now | ~57 MB |
| while connected | ~+10 MB (spare renderer becomes a loaded one) |

The wins were `app.disableHardwareAcceleration()` (GPU process 17.1 → 7.1 MB;
we composite a static text panel, so it bought nothing), the on-demand
window, and the `spellcheck`/`webgl`/`enableWebSQL` opt-outs. A V8
`--max-old-space-size` cap was deliberately **not** added — it doesn't lower
the baseline, and this app stores ~10 numbers with no accumulation, so a heap
cap would only add a crash risk.

The remaining ~11.7 MB "renderer" in a fresh process list is Chromium's
**spare** renderer, not ours (verified: `BrowserWindow.getAllWindows()` is 0
at startup). It's pre-paid memory that gets used when the popover first
opens, and the switch that disables it has been renamed across Chromium
versions, so chasing it isn't worth the fragility. ~57 MB is roughly
Electron's floor here; getting to ~20 MB means a native Swift rewrite that
discards all `pm5-base` reuse.

`backgroundThrottling: false` is a correctness setting, not a memory one:
the popover is hidden almost always, and Chromium clamps timers in hidden
renderers to ~1s, which would throttle `pm5-hid.js`'s 100ms poll and
`pm5-mock.js`'s chained `setTimeout`s exactly when the tray text is all you
can see.

## Min-pace coloring

The `#min-pace` popover input (m:ss/500m, e.g. "2:00") sets `minPaceSeconds`,
persisted in `localStorage` (per-viewer, Electron-app-scoped — no shared
state needed here). It's compared directly against whichever pace field
`PACE_KEYS` resolves (`currentPace` on BLE, `pace` on HID) — both are raw
seconds/500m already (see `pm5-base/lib/pm5-fields.js`'s pace note), so no
scaling needed. `paceDot()` is the raw comparison (smaller/faster-or-equal
= 🟢, slower = 🔴, no threshold set = no dot); it only prefixes the Tray's
headline text, not the popover's own pace row. The Tray headline itself
falls back from pace to watts (`POWER_KEYS`) when no pace field has arrived
yet — that fallback never gets a color dot, pace-only.

## Running it

```
npm install
npm start
```

No packaging/signing yet (see README.md's Status section) — dev-run only.

## Testing

```
node --test
```

Also runs `pm5-base`'s own test suite (it's a submodule under this tree).
There's no linter configured, matching `pm5-base`.
