const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true },
}]);

// Definir carpetas escribibles ANTES de cargar la logica.
process.env.CONVERTO_BIN_DIR = path.join(app.getPath('userData'), 'bin');
process.env.CONVERTO_WORK_DIR = path.join(app.getPath('temp'), 'converto-work');

const { resolveTracks, convertTrack } = require('../lib/audio');
const { sanitizeFilename } = require('../lib/sanitize');

let win;
let selectedFolder = null;
const UI_URL = 'app://converto/index.html';
const UI_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['style.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['logo.svg', 'image/svg+xml'],
]);

function configureAppProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname.slice(1));
    const contentType = url.hostname === 'converto' && UI_FILES.get(name);
    if (!contentType) return new Response('Not found', { status: 404 });
    const content = fs.readFileSync(path.join(__dirname, '..', 'public', name));
    return new Response(content, { headers: { 'content-type': contentType } });
  });
}

function assertTrustedEvent(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
    throw new Error('Solicitud no autorizada');
  }
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} inválido`);
  }
  return value.trim();
}

function isAllowedUrl(value, allowSearch = false) {
  if (allowSearch && value.startsWith('ytsearch1:')) return value.length <= 600;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'spotify.com' || host.endsWith('.spotify.com')
    );
  } catch {
    return false;
  }
}

function validateInput(input) {
  const value = requiredString(input, 'Links', 20_000);
  const links = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (links.length > 100 || links.some((link) => !isAllowedUrl(link))) {
    throw new Error('Usá hasta 100 links HTTPS válidos de YouTube o Spotify');
  }
  return links.join('\n');
}

function validateTrack(track) {
  if (!track || typeof track !== 'object') throw new Error('Tema inválido');
  const url = requiredString(track.url, 'URL del tema', 2_048);
  if (!isAllowedUrl(url, true)) throw new Error('URL del tema no permitida');
  return {
    url,
    title: requiredString(track.title, 'Título', 500),
    idOn: track.idOn === true,
    idText: typeof track.idText === 'string' ? track.idText.slice(0, 500) : '',
  };
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on('error', (error) => console.error('[converto] actualización:', error));
  autoUpdater.on('update-downloaded', ({ version }) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Actualización lista',
      message: `Converto ${version} ya está listo.`,
      detail: 'Reiniciá ahora para instalar la nueva versión, o seguí usando la app y se instalará al cerrarla.',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.checkForUpdates().catch((error) => console.error('[converto] actualización:', error));
}

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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== UI_URL) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (event, input) => {
    const opensDevTools = input.type === 'keyDown' && (
      input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
    );
    if (opensDevTools) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  win.loadURL(UI_URL);
}

app.whenReady().then(() => {
  console.log('[converto] app ready');
  configureAppProtocol();
  createWindow();
  configureAutoUpdates();
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

ipcMain.handle('resolve', async (event, { input, mode } = {}) => {
  assertTrustedEvent(event);
  return await resolveTracks(validateInput(input), mode === 'playlist' ? 'playlist' : 'single');
});

ipcMain.handle('pick-folder', async (event) => {
  assertTrustedEvent(event);
  const r = await dialog.showOpenDialog(win, {
    title: 'Elegí dónde guardar los audios (puede ser el pendrive o los auriculares)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  selectedFolder = path.resolve(r.filePaths[0]);
  return selectedFolder;
});

ipcMain.handle('convert', async (event, { track, format } = {}) => {
  assertTrustedEvent(event);
  if (!selectedFolder || !fs.statSync(selectedFolder, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Elegí nuevamente la carpeta de destino');
  }
  const safeTrack = validateTrack(track);
  const fmt = format === 'flac' ? 'flac' : 'mp3';
  const { buffer, ext } = await convertTrack({
    url: safeTrack.url,
    title: safeTrack.title,
    format: fmt,
    identifier: safeTrack.idOn,
    identifierText: safeTrack.idText,
  });

  const base = sanitizeFilename(safeTrack.title);
  let filename = `${base}.${ext}`;
  let full = path.join(selectedFolder, filename);
  let n = 1;
  while (fs.existsSync(full)) {
    filename = `${base} (${n}).${ext}`;
    full = path.join(selectedFolder, filename);
    n++;
  }
  fs.writeFileSync(full, buffer);
  return { filename };
});

// Abrir la carpeta destino en el explorador al terminar.
ipcMain.handle('open-folder', async (event) => {
  assertTrustedEvent(event);
  if (selectedFolder) return shell.openPath(selectedFolder);
});
