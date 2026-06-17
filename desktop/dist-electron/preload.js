// Preload script — written directly in CommonJS to avoid ESM/CJS conflicts with Electron.
// Electron loads preload files as CommonJS, so we use `require` and `module.exports`.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Mastra lifecycle
  startMastra: (workspacePath) => ipcRenderer.invoke('mastra:start', workspacePath),
  stopMastra: () => ipcRenderer.invoke('mastra:stop'),
  getMastraStatus: () => ipcRenderer.invoke('mastra:status'),

  // Auth shared with the Node-side Mastra agent
  setAuthSession: (session) => ipcRenderer.invoke('auth:setSession', session),
  clearAuthSession: () => ipcRenderer.invoke('auth:clearSession'),

  // Direct SDK agent runner in Electron main
  startAgentStream: (payload) => ipcRenderer.invoke('agent:stream:start', payload),
  respondAgentApproval: (payload) => ipcRenderer.invoke('agent:approval:respond', payload),
  cancelAgentStream: (sessionId) => ipcRenderer.invoke('agent:stream:cancel', sessionId),
  onAgentStreamEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('agent:stream-event', listener)
    return () => ipcRenderer.removeListener('agent:stream-event', listener)
  },

  // Memory/session API proxied through Electron main
  listMemoryThreads: (params) => ipcRenderer.invoke('memory:listThreads', params),
  createMemoryThread: (params) => ipcRenderer.invoke('memory:createThread', params),
  deleteMemoryThread: (threadId, opts) => ipcRenderer.invoke('memory:deleteThread', threadId, opts),
  listThreadMessages: (threadId, opts) => ipcRenderer.invoke('memory:listThreadMessages', threadId, opts),

  // Workspace folder picker
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),

  // Open URL in default browser
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
})
