const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro: la interfaz solo puede llamar a estas funciones.
contextBridge.exposeInMainWorld('api', {
  resolve: (input, mode) => ipcRenderer.invoke('resolve', { input, mode }),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  convert: (track, format) => ipcRenderer.invoke('convert', { track, format }),
  cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
});
