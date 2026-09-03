const el = sel => document.querySelector(sel);

// Same transport map as pm5-base/example/app.js -- all three share the
// connect/disconnect/connected + MESSAGE_EVENTS interface, so no
// per-transport branching below. Mock falls back to the bundled demo CSV.
const TRANSPORTS = {
    bluetooth: { label: 'Bluetooth', build: () => new PM5(),    supported: () => !!navigator.bluetooth },
    usb:       { label: 'USB',       build: () => new PM5HID(), supported: () => !!navigator.hid },
    mock: {
        label: 'Mock',
        build: () => new PM5Mock({
            loadSamples: () => csvSource.loadFromUrl('pm5-base/lib/mock-data/concept2-result-44214428.csv'),
            emulate: 'ble',
            loop: true,
        }),
        supported: () => true,
    },
};

// Popover rows, in display order. Each entry is the field's possible key
// names across transports (BLE name first, then HID's) -- whichever one
// shows up in the data wins.
const ROWS = [
    { keys: ['elapsedTime', 'workTime'] },
    { keys: ['distance', 'workDistance'] },
    { keys: ['currentPace', 'pace'] },
    { keys: ['averagePower', 'power'] },
    { keys: ['strokeRate', 'cadence'] },
    { keys: ['heartRate'] },
];

// Tray headline: pace preferred, watts as a fallback when no pace field has
// shown up yet. Raw values for both are whole (or 0.01) seconds/500m -- see
// pm5-base's pm5-fields.js -- so they're directly comparable with no scaling.
const PACE_KEYS = ['currentPace', 'pace'];
const POWER_KEYS = ['averagePower', 'power'];

const MIN_PACE_STORAGE_KEY = 'pm5-menubar-min-pace-seconds';

let monitor = null;
let values = {};        // latest raw value per pm5fields key seen so far
let ergMachineType;     // see pm5-fields.js -- only BLE's additional-status carries this
let minPaceSeconds = null; // slowest acceptable pace, in raw seconds/500m; null = no threshold set

// Pure enough to unit-test without a DOM -- see test/renderer.test.mjs.
function pickField(keys, values) {
    return keys.find(k => k in values);
}

// "m:ss" -> seconds, or null if unparseable/empty (used to both validate the
// input and store the threshold in the same raw units pace fields use).
function parsePaceInput(text) {
    const m = /^(\d+):([0-5]?\d)$/.exec(text.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatPaceInput(secs) {
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// A smaller raw value is a faster split, so "at or under the minimum
// acceptable pace" is green, slower is red. null threshold = no color.
function paceDot(raw, min) {
    if (min == null) return '';
    return (raw <= min ? '🟢' : '🔴') + ' ';
}

function renderFields() {
    const rowsHtml = ROWS
        .map(({ keys }) => pickField(keys, values))
        .filter(Boolean)
        .map(k => `<div class="field"><span class="field-label">${pm5fields[k].label}</span><span>${pm5fields[k].printable(values[k], ergMachineType)}</span></div>`)
        .join('');
    el('#fields').innerHTML = rowsHtml;

    const paceKey = pickField(PACE_KEYS, values);
    if (paceKey !== undefined) {
        const dot = paceDot(values[paceKey], minPaceSeconds);
        window.trayBar.setTitle(dot + pm5fields[paceKey].printable(values[paceKey], ergMachineType));
        return;
    }
    const powerKey = pickField(POWER_KEYS, values);
    window.trayBar.setTitle(powerKey !== undefined ? pm5fields[powerKey].printable(values[powerKey], ergMachineType) : 'PM5');
}

function cbMessage(event) {
    ergMachineType = event.data.ergMachineType ?? ergMachineType;
    for (const [k, v] of Object.entries(event.data)) {
        if (k in pm5fields) values[k] = v;
    }
    renderFields();
}

function cbConnecting() {
    // From here on main must not release this window -- see main.js's
    // keepAlive. Set on *connecting*, not connected, so an OS Bluetooth
    // prompt stealing focus can't blur the popover away mid-handshake.
    window.trayBar.setKeepAlive(true);
    el('#connect').textContent = 'Connecting';
    el('#connect').disabled = true;
    el('#transport').disabled = true;
    el('#status').textContent = 'Please wait…';
}

function cbConnected() {
    el('#connect').textContent = 'Disconnect';
    el('#connect').disabled = false;
    el('#status').textContent = 'Connected';

    // Instance-first: PM5Mock sets MESSAGE_EVENTS per instance, PM5/PM5HID
    // only have the static list. See pm5-base's app.js for the same read.
    const events = monitor.MESSAGE_EVENTS ?? monitor.constructor.MESSAGE_EVENTS;
    for (const type of events) monitor.addEventListener(type, cbMessage);
}

function cbDisconnected() {
    el('#connect').textContent = 'Connect';
    el('#connect').disabled = false;
    el('#transport').disabled = false;
    el('#status').textContent = '';
    el('#fields').innerHTML = '';
    values = {};
    ergMachineType = undefined;
    window.trayBar.setTitle('PM5');
    window.trayBar.setKeepAlive(false); // main may now reclaim this window once it's hidden
    monitor = null;
}

// Guarded so test/renderer.test.mjs can `require` this file under node to
// reach pickField() without a document existing -- a no-op in the browser.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const transportSel = el('#transport');
    const minPaceInput = el('#min-pace');

    const stored = parsePaceInput(localStorage.getItem(MIN_PACE_STORAGE_KEY) ?? '');
    if (stored != null) {
        minPaceSeconds = stored;
        minPaceInput.value = formatPaceInput(stored);
    }

    minPaceInput.addEventListener('change', () => {
        const secs = parsePaceInput(minPaceInput.value);
        minPaceSeconds = secs;
        if (secs == null) {
            localStorage.removeItem(MIN_PACE_STORAGE_KEY);
            minPaceInput.value = '';
        } else {
            localStorage.setItem(MIN_PACE_STORAGE_KEY, String(secs));
            minPaceInput.value = formatPaceInput(secs); // normalize e.g. "2:5" -> "2:05"
        }
        renderFields();
    });

    let firstSupported = null;
    for (const [id, t] of Object.entries(TRANSPORTS)) {
        const opt = transportSel.querySelector(`option[value="${id}"]`);
        if (t.supported()) {
            firstSupported ??= id;
        } else {
            opt.disabled = true;
            opt.textContent += ' (unsupported)';
        }
    }
    if (firstSupported) transportSel.value = firstSupported;

    el('#connect').addEventListener('click', () => {
        if (monitor?.connected()) {
            monitor.disconnect();
            return;
        }

        monitor = TRANSPORTS[transportSel.value].build();
        monitor.addEventListener('connecting', cbConnecting);
        monitor.addEventListener('connected', cbConnected);
        monitor.addEventListener('disconnected', cbDisconnected);

        monitor.connect()
            .then(() => { if (!monitor?.connected()) cbDisconnected(); }) // picker cancelled
            .catch((error) => {
                console.error(error);
                cbDisconnected();
                el('#status').textContent = error.message;
            });
    });
});

// ponytail: export shim so test/renderer.test.mjs can import these pure
// functions under node; a no-op in the browser (no `module`).
if (typeof module !== 'undefined') {
    module.exports = { pickField, parsePaceInput, formatPaceInput, paceDot };
}
