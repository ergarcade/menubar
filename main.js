const { app, BrowserWindow, Tray, nativeImage, session, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 320, HEIGHT = 420;

// Must be called before the app is ready. We composite a static text panel,
// so hardware acceleration buys nothing and costs a GPU process
// (measured: 17.1MB -> 9.6MB physical footprint with it off).
app.disableHardwareAcceleration();

let tray;
let win = null;
// Set by the renderer, which owns the BLE/HID connection: true from the
// moment a connect starts until it drops. The window can't be torn down
// while it's set, or we'd kill the live workout mid-row -- and it covers
// *connecting* too, since an OS Bluetooth prompt stealing focus would
// otherwise blur the popover and release the window mid-handshake.
let keepAlive = false;

function createWindow() {
    win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: false,
        frame: false,
        resizable: false,
        fullscreenable: false,
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            // The popover is hidden nearly all the time, and Chromium clamps
            // timers in hidden renderers to ~1s -- that would throttle
            // pm5-hid.js's 100ms poll and pm5-mock.js's chained setTimeouts
            // to a crawl exactly when the tray text is all you can see.
            backgroundThrottling: false,
            // Nothing here spellchecks, draws GL, or touches WebSQL; leaving
            // them off keeps those subsystems from initialising at all.
            spellcheck: false,
            webgl: false,
            enableWebSQL: false,
        },
    });
    win.loadFile('renderer.html');
    win.on('blur', () => {
        win?.hide();
        releaseIfIdle();
    });
}

// Reclaims the renderer (~21MB) once the popover is both out of sight and
// not holding a connection. Deferred a tick so we never destroy a window
// from inside its own event handler.
function releaseIfIdle() {
    if (!win || keepAlive || win.isVisible()) return;
    const doomed = win;
    win = null;
    setImmediate(() => doomed.destroy());
}

function showAtTray() {
    const trayBounds = tray.getBounds();
    const { width, height } = win.getBounds();
    win.setPosition(
        Math.round(trayBounds.x + trayBounds.width / 2 - width / 2),
        Math.round(trayBounds.y + trayBounds.height),
        false,
    );
    win.show();
    win.focus();
}

function togglePopover() {
    if (win?.isVisible()) {
        win.hide();
        return;
    }
    if (win) {
        showAtTray();
        return;
    }
    // Built on demand, so a disconnected app in the menu bar costs no
    // renderer at all. ready-to-show avoids flashing an empty panel.
    createWindow();
    win.once('ready-to-show', showAtTray);
}

app.whenReady().then(() => {
    // No icon asset (ponytail: text-only tray, one less file to ship) --
    // the tray shows its live headline metric as text, set by renderer.js.
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('PM5');
    tray.setToolTip('PM5 Monitor');
    tray.on('click', togglePopover);

    // renderer.js pushes its computed headline text here (see preload.js).
    ipcMain.on('tray-title', (event, title) => tray.setTitle(title));

    // ...and whether it's still holding a transport session, which gates
    // whether the window may be released. A link dropping while the popover
    // is already hidden should reclaim it right away.
    ipcMain.on('keep-alive', (event, value) => {
        keepAlive = value;
        if (!keepAlive) releaseIfIdle();
    });

    // Web Bluetooth: Electron pauses the connection and asks the main
    // process to pick a device instead of showing a native chooser. We only
    // ever want one PM5, so grab the first match and stop scanning.
    app.on('select-bluetooth-device', (event, deviceList, callback) => {
        event.preventDefault();
        const device = deviceList.find(d => d.deviceName?.startsWith('PM5')) ?? deviceList[0];
        callback(device ? device.deviceId : '');
    });

    // WebHID: same idea for the USB device picker, plus permission handlers
    // so navigator.hid.requestDevice()'s grant works at all (Electron denies
    // by default with no handler installed).
    session.defaultSession.on('select-hid-device', (event, details, callback) => {
        event.preventDefault();
        callback(details.deviceList[0]?.deviceId);
    });
    session.defaultSession.setDevicePermissionHandler(() => true);
    session.defaultSession.setPermissionCheckHandler(() => true);
});

// Menu-bar app: keep running with no windows open. Load-bearing now that the
// popover is destroyed when idle -- merely *having* a listener here is what
// stops Electron's default quit-on-last-window-closed, so this empty body is
// the whole point.
app.on('window-all-closed', () => {});
