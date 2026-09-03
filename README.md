# menubar

A macOS menu-bar app showing live [Concept2 PM5](https://www.concept2.com/indoor-rowers/performance-monitors)
metrics (pace, distance, watts, stroke rate, heart rate) — over Bluetooth or
USB, or replayed from a demo workout with no hardware.

Set a minimum pace (m:ss/500m) in the popover and the menu-bar text gets a
🟢/🔴 dot: green while you're at or faster than that split, red when you
slip slower. The threshold is remembered across restarts.

It's an Electron shell around [`pm5-base`](https://github.com/ergarcade/pm5-base)
(a submodule here): `main.js` puts a `Tray` icon in the menu bar showing the
live pace/watts as text, with a popover for connecting and the full field
list. All the PM5 protocol/transport code (`pm5-base/lib/*.js`) is used
unchanged — Electron's renderer supports Web Bluetooth and WebHID, so no
protocol code needed reimplementing.

## Setup

```
git clone --recurse-submodules https://github.com/ergarcade/menubar.git
cd menubar
npm install
npm start
```

Already cloned without `--recurse-submodules`? Run `git submodule update --init`.

To pull in `pm5-base` library updates later:

```
git submodule update --remote pm5-base
```

## Memory

~57 MB idle (physical footprint). The popover window is built on first tray
click and torn down again once it's hidden and not connected, hardware
acceleration is off, and unused Chromium subsystems (spellcheck, WebGL,
WebSQL) are disabled. Note `ps` RSS reports ~380 MB for this — it
double-counts shared Chromium pages; `vmmap --summary` gives the real number.

## Status

v1: Bluetooth, USB, and Mock transports, no packaging (run via `npm start`),
no login item. See `pm5-base`'s own README for what each transport needs
(Bluetooth/USB both require Chromium — here, Electron — Mock works anywhere).
