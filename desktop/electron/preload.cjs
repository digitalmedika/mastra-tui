// Preload script — written directly in CommonJS to avoid ESM/CJS conflicts with Electron.
// Electron loads preload files as CommonJS, so we use `require` and `module.exports`.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Mastra lifecycle
  startMastra: (workspacePath) => ipcRenderer.invoke('mastra:start', workspacePath),
  stopMastra: () => ipcRenderer.invoke('mastra:stop'),
  getMastraStatus: () => ipcRenderer.invoke('mastra:status'),

  // Workspace folder picker
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),

  // Open URL in default browser
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
})
