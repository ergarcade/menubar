const { contextBridge, ipcRenderer } = require('electron');

// What the renderer needs from the main process: pushing the live headline
// metric onto the Tray's title, and telling it whether a transport session
// is still held (main destroys the idle popover to reclaim the renderer, so
// it has to know when that would kill a live connection).
contextBridge.exposeInMainWorld('trayBar', {
    setTitle: (text) => ipcRenderer.send('tray-title', text),
    setKeepAlive: (value) => ipcRenderer.send('keep-alive', value),
});
