const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  await window.loadFile(path.join(__dirname, '..', 'public', 'logo.svg'));
  await window.webContents.executeJavaScript('new Promise(requestAnimationFrame)');
  const image = await window.webContents.capturePage();
  const outputDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'icon.png'), image.toPNG());
  app.quit();
});