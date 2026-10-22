const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  analyzeMedia: (filePath) => ipcRenderer.invoke('media:analyze', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (data, filePath) => ipcRenderer.invoke('project:save', data, filePath),
  openProject: () => ipcRenderer.invoke('project:open'),
  pickRenderPath: (defaultName, type) => ipcRenderer.invoke('render:pickPath', defaultName, type),
  startRender: (project, settings, outPath) => ipcRenderer.invoke('render:start', project, settings, outPath),
  cancelRender: () => ipcRenderer.invoke('render:cancel'),
  onRenderProgress: (callback) => {
    const handler = (_e, progress) => callback(progress);
    ipcRenderer.on('render:progress', handler);
    return () => ipcRenderer.removeListener('render:progress', handler);
  },
  recordStart: (projectPath, sampleRate) => ipcRenderer.invoke('record:start', projectPath, sampleRate),
  recordWrite: (id, chunk) => ipcRenderer.send('record:write', id, chunk),
  recordStop: (id) => ipcRenderer.invoke('record:stop', id),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  onUpdateState: (callback) => {
    const handler = (_e, state) => callback(state);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },
  displayCount: () => ipcRenderer.invoke('screen:count'),
  extractFrame: (filePath, time, projectPath) => ipcRenderer.invoke('media:frame', filePath, time, projectPath),
  filmstrip: (filePath) => ipcRenderer.invoke('media:filmstrip', filePath),
  // Proxies de la vista previa.
  makeProxy: (filePath) => ipcRenderer.invoke('proxy:make', filePath),
  removeProxy: (filePath) => ipcRenderer.invoke('proxy:remove', filePath),
  proxyUsage: () => ipcRenderer.invoke('proxy:usage'),
  clearProxies: () => ipcRenderer.invoke('proxy:clear'),
  onProxyProgress: (callback) => {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('proxy:progress', handler);
    return () => ipcRenderer.removeListener('proxy:progress', handler);
  },
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),
  setDirty: (dirty) => ipcRenderer.send('project:dirty', dirty),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  autosave: (data, projectPath) => ipcRenderer.invoke('autosave:write', data, projectPath),
  clearAutosave: () => ipcRenderer.invoke('autosave:clear'),
  checkAutosave: () => ipcRenderer.invoke('autosave:check'),
  onFullScreenChange: (callback) => {
    const handler = (_e, value) => callback(value);
    ipcRenderer.on('window:fullscreen', handler);
    return () => ipcRenderer.removeListener('window:fullscreen', handler);
  },
  onSaveBeforeClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('project:saveBeforeClose', handler);
    return () => ipcRenderer.removeListener('project:saveBeforeClose', handler);
  },
});
