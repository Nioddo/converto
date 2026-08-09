const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Definir carpetas escribibles ANTES de cargar la logica.
process.env.CONVERTO_BIN_DIR = path.join(app.getPath('userData'), 'bin');
process.env.CONVERTO_WORK_DIR = path.join(app.getPath('temp'), 'converto-work');

const { resolveTracks, convertTrack } = require('../lib/audio');
const { sanitizeFilename } = require('../lib/sanitize');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 920,
    height: 800,
    minWidth: 680,
    minHeight: 560,
    backgroundColor: '#0b0f14',
    title: 'Converto',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
}

app.whenReady().then(() => {
  console.log('[converto] app ready');
  createWindow();
  win.webContents.on('did-finish-load', () => console.log('[converto] UI cargada OK'));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[converto] fallo de carga:', code, desc));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: la interfaz llama a estas funciones ---

ipcMain.handle('resolve', async (_e, { input, mode }) => {
  return await resolveTracks(input, mode === 'playlist' ? 'playlist' : 'single');
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elegí dónde guardar los audios (puede ser el pendrive o los auriculares)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('convert', async (_e, { track, format, folder }) => {
  const fmt = format === 'flac' ? 'flac' : 'mp3';
  const { buffer, ext } = await convertTrack({
    url: track.url,
    title: track.title,
    format: fmt,
    identifier: !!track.idOn,
    identifierText: track.idText,
  });

  const base = sanitizeFilename(track.title);
  let filename = `${base}.${ext}`;
  let full = path.join(folder, filename);
  let n = 1;
  while (fs.existsSync(full)) {
    filename = `${base} (${n}).${ext}`;
    full = path.join(folder, filename);
    n++;
  }
  fs.writeFileSync(full, buffer);
  return { filename };
});

// Abrir la carpeta destino en el explorador al terminar.
ipcMain.handle('open-folder', async (_e, folder) => {
  if (folder) shell.openPath(folder);
});
