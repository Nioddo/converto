const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const ffmpegStatic = require('ffmpeg-static');

const isWin = process.platform === 'win32';

// Carpeta donde guardamos yt-dlp. En la app empaquetada, Electron define
// CONVERTO_BIN_DIR (una carpeta escribible del usuario). Si no, ./.bin
function getBinDir() {
  return process.env.CONVERTO_BIN_DIR || path.join(process.cwd(), '.bin');
}

const YT_DLP_URL = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const YT_DLP_FILE = isWin ? 'yt-dlp.exe' : 'yt-dlp';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (u, redirects = 0) => {
      if (redirects > 6) return reject(new Error('Demasiadas redirecciones al bajar yt-dlp'));
      https
        .get(u, { headers: { 'User-Agent': 'converto' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return request(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('HTTP ' + res.statusCode + ' al bajar yt-dlp'));
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
          file.on('error', reject);
        })
        .on('error', reject);
    };
    request(url);
  });
}

// Devuelve la ruta a yt-dlp, descargandolo la primera vez si hace falta.
async function getYtDlpPath() {
  const binDir = getBinDir();
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, YT_DLP_FILE);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1_000_000) {
    await download(YT_DLP_URL, dest);
    if (!isWin) fs.chmodSync(dest, 0o755);
  }
  return dest;
}

// Ruta al binario de ffmpeg. En la app empaquetada el binario queda "desempaquetado"
// del asar; corregimos la ruta para apuntar a app.asar.unpacked.
function getFfmpegPath() {
  let p = ffmpegStatic;
  if (!p) throw new Error('No se encontro el binario de ffmpeg (ffmpeg-static)');
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    p = p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

module.exports = { getYtDlpPath, getFfmpegPath };
