const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  compact: (value) => ipcRenderer.invoke('window:compact', value),
  appearance: (theme) => ipcRenderer.invoke('window:appearance', theme),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  notify: (body) => ipcRenderer.send('timer:notify', body),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  anki: {
    import: () => ipcRenderer.invoke('anki:import'),
    addMedia: (bytes, name) => ipcRenderer.invoke('anki:media-add', bytes, name),
    readMedia: meta => ipcRenderer.invoke('anki:media-read', meta),
  },
  books: {
    import: () => ipcRenderer.invoke('books:import'),
    read: (hash, format) => ipcRenderer.invoke('books:read', hash, format),
    thumbnail: hash => ipcRenderer.invoke('books:thumbnail', hash),
    cacheThumbnail: (hash, src) => ipcRenderer.invoke('books:cache-thumbnail', hash, src),
    restore: token => ipcRenderer.invoke('books:restore', token),
    cancelRestore: token => ipcRenderer.invoke('books:cancel-restore', token),
  },
  imagesPending: count => ipcRenderer.send('images:pending', count),
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    authenticate: (mode, email, password, profile) => ipcRenderer.invoke('cloud:authenticate', mode, email, password, profile),
    updateProfile: value => ipcRenderer.invoke('cloud:profile', value),
    skip: () => ipcRenderer.invoke('cloud:skip'),
    signOut: () => ipcRenderer.invoke('cloud:signout'),
    sync: () => ipcRenderer.invoke('cloud:sync'),
    chooseLocal: () => ipcRenderer.invoke('cloud:local'),
    download: () => ipcRenderer.invoke('cloud:download'),
    acceptDownload: () => ipcRenderer.invoke('cloud:accept'),
    closeReady: () => ipcRenderer.invoke('cloud:close-ready'),
    onStatus: callback => { const handler = (_event, status) => callback(status); ipcRenderer.on('cloud:status', handler); return () => ipcRenderer.removeListener('cloud:status', handler); },
    onPrepareClose: callback => { const handler = () => callback(); ipcRenderer.on('cloud:prepare-close', handler); return () => ipcRenderer.removeListener('cloud:prepare-close', handler); },
  },
  modules: {
    call: (module, action, payload = {}) => ipcRenderer.invoke('modules:call', module, action, payload),
    watch: orgId => ipcRenderer.invoke('modules:watch', orgId),
    onChanged: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('modules:changed', handler); return () => ipcRenderer.removeListener('modules:changed', handler); },
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    check: () => ipcRenderer.invoke('plugins:check'),
    install: id => ipcRenderer.invoke('plugins:install', id),
    remove: id => ipcRenderer.invoke('plugins:remove', id),
    rollback: (id, version) => ipcRenderer.invoke('plugins:rollback', id, version),
    entry: id => ipcRenderer.invoke('plugins:entry', id),
    onChanged: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('plugins:changed', handler); return () => ipcRenderer.removeListener('plugins:changed', handler); },
  },
  startup: {
    status: () => ipcRenderer.invoke('startup:status'),
    set: enabled => ipcRenderer.invoke('startup:set', enabled),
  },
  reminders: { startup: () => ipcRenderer.invoke('reminders:startup') },
  onOpenReminders: callback => {
    const handler = () => callback();
    ipcRenderer.on('reminders:open', handler);
    return () => ipcRenderer.removeListener('reminders:open', handler);
  },
  updates: {
    opened: () => ipcRenderer.invoke('updates:opened'),
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
  },
  onUpdate: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('updates:status', handler);
    return () => ipcRenderer.removeListener('updates:status', handler);
  },
  onSuspend: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('timer:suspend', handler);
    return () => ipcRenderer.removeListener('timer:suspend', handler);
  },
});
