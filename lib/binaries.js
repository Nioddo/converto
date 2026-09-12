const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
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
const YT_DLP_SUMS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';
const YT_DLP_FILE = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const TRUSTED_HASH_FILE = `${YT_DLP_FILE}.sha256`;
const UPDATE_CHECK_FILE = 'yt-dlp-security-check-v2';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_BINARY_BYTES = 100 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function checkedUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error('Origen no permitido al bajar yt-dlp');
  }
  return parsed;
}

function download(url, dest, maxBytes = MAX_BINARY_BYTES) {
  return new Promise((resolve, reject) => {
    const request = (u, redirects = 0) => {
      if (redirects > 6) return reject(new Error('Demasiadas redirecciones al bajar yt-dlp'));
      let parsed;
      try {
        parsed = checkedUrl(u);
      } catch (error) {
        return reject(error);
      }
      const req = https
        .get(parsed, { headers: { 'User-Agent': 'converto' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return request(new URL(res.headers.location, parsed).href, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('HTTP ' + res.statusCode + ' al bajar yt-dlp'));
          }
          const declaredSize = Number(res.headers['content-length'] || 0);
          if (declaredSize > maxBytes) {
            res.resume();
            return reject(new Error('La descarga de yt-dlp supera el tamaño permitido'));
          }
          const file = fs.createWriteStream(dest);
          let received = 0;
          res.on('data', (chunk) => {
            received += chunk.length;
            if (received > maxBytes) req.destroy(new Error('La descarga de yt-dlp supera el tamaño permitido'));
          });
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
          file.on('error', reject);
        })
        .on('error', reject);
      req.setTimeout(30_000, () => req.destroy(new Error('Tiempo agotado al bajar yt-dlp')));
    };
    request(url);
  });
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function getExpectedHash(binDir) {
  const sumsFile = path.join(binDir, 'SHA2-256SUMS.download');
  try {
    await download(YT_DLP_SUMS_URL, sumsFile, 100_000);
    const line = fs.readFileSync(sumsFile, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.trim().endsWith(` ${YT_DLP_FILE}`));
    const hash = line && line.trim().split(/\s+/)[0].toLowerCase();
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash oficial de yt-dlp inválido');
    return hash;
  } finally {
    fs.rmSync(sumsFile, { force: true });
  }
}

function replaceBinary(temp, dest) {
  const backup = `${dest}.backup`;
  fs.rmSync(backup, { force: true });
  if (fs.existsSync(dest)) fs.renameSync(dest, backup);
  try {
    fs.renameSync(temp, dest);
    fs.rmSync(backup, { force: true });
  } catch (error) {
    if (fs.existsSync(backup)) fs.renameSync(backup, dest);
    throw error;
  }
}

async function updateYtDlp(binary, binDir) {
  const marker = path.join(binDir, UPDATE_CHECK_FILE);
  const trustedHashPath = path.join(binDir, TRUSTED_HASH_FILE);
  const trustedHash = fs.existsSync(trustedHashPath) ? fs.readFileSync(trustedHashPath, 'utf8').trim() : '';
  const currentHash = fs.existsSync(binary) ? await sha256File(binary) : '';
  if (
    currentHash && currentHash === trustedHash && fs.existsSync(marker) &&
    Date.now() - fs.statSync(marker).mtimeMs < UPDATE_INTERVAL_MS
  ) {
    return;
  }

  const expectedHash = await getExpectedHash(binDir);
  if (currentHash !== expectedHash) {
    const temp = `${binary}.download`;
    fs.rmSync(temp, { force: true });
    try {
      await download(YT_DLP_URL, temp);
      if (await sha256File(temp) !== expectedHash) throw new Error('La firma SHA-256 de yt-dlp no coincide');
      replaceBinary(temp, binary);
      if (!isWin) fs.chmodSync(binary, 0o755);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  fs.writeFileSync(trustedHashPath, expectedHash, { encoding: 'ascii', mode: 0o600 });
  fs.closeSync(fs.openSync(marker, 'w'));
}

// Devuelve la ruta a yt-dlp, descargandolo la primera vez si hace falta.
async function getYtDlpPath() {
  const binDir = getBinDir();
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, YT_DLP_FILE);
  await updateYtDlp(dest, binDir);
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
