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
});
