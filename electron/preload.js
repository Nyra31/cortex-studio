const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  analyzeMedia: (filePath) => ipcRenderer.invoke('media:analyze', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (data, filePath) => ipcRenderer.invoke('project:save', data, filePath),
  openProject: () => ipcRenderer.invoke('project:open'),
  pickRenderPath: (defaultName) => ipcRenderer.invoke('render:pickPath', defaultName),
  startRender: (project, settings, outPath) => ipcRenderer.invoke('render:start', project, settings, outPath),
  cancelRender: () => ipcRenderer.invoke('render:cancel'),
  onRenderProgress: (callback) => {
    const handler = (_e, progress) => callback(progress);
    ipcRenderer.on('render:progress', handler);
    return () => ipcRenderer.removeListener('render:progress', handler);
  },
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),
  setDirty: (dirty) => ipcRenderer.send('project:dirty', dirty),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
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
