// Runs sandboxed in the window. Exposes a fixed list of calls; the interface never gets raw IPC or Node access.
const { contextBridge, ipcRenderer } = require('electron')

const calls = [
  'getState', 'activateLicense', 'activateLicenseByAccount', 'deactivateLicense', 'connectGoogle', 'cancelConnect', 'disconnectGoogle', 'useLocalOnly',
  'loadData', 'saveData', 'syncNow', 'resolveConflict', 'takeOverLock', 'listAudit', 'listRevisions', 'restoreRevision',
  'exportBackup', 'importBackup', 'storageQuota', 'savePdf', 'setErrorReports', 'reportError', 'checkUpdate', 'installUpdate', 'downloadUpdate',
  'openExternal', 'quit', 'setGoogleClient', 'backupNow',
  'login', 'logout', 'createUser', 'listUsers', 'setUserActive', 'changePassword', 'recoverPassword', 'listAccess',
]
const events = { onSync: 'sync', onDataReplaced: 'data-replaced', onLicense: 'license', onUpdate: 'update' }

const api = {}
for (const name of calls) api[name] = (...args) => ipcRenderer.invoke(`aicom:${name}`, ...args)
for (const [name, channel] of Object.entries(events)) {
  api[name] = (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on(`aicom:${channel}`, handler)
    return () => ipcRenderer.removeListener(`aicom:${channel}`, handler)
  }
}

contextBridge.exposeInMainWorld('aicom', api)
