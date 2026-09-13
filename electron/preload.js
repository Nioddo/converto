const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro: la interfaz solo puede llamar a estas funciones.
contextBridge.exposeInMainWorld('api', {
  resolve: (input, mode) => ipcRenderer.invoke('resolve', { input, mode }),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  convert: (track, format) => ipcRenderer.invoke('convert', { track, format }),
  saveFailureReport: (failures) => ipcRenderer.invoke('save-failure-report', { failures }),
  cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
});
