import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import ffmpegStatic from 'ffmpeg-static';

const isWin = process.platform === 'win32';
const onVercel = !!process.env.VERCEL;

// En Vercel solo /tmp es escribible. En local guardamos el binario en ./.bin
const binDir = onVercel ? '/tmp/bin' : path.join(process.cwd(), '.bin');

const YT_DLP_URL = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

const YT_DLP_FILE = isWin ? 'yt-dlp.exe' : 'yt-dlp';

// Descarga siguiendo redirecciones (GitHub -> CDN).
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
export async function getYtDlpPath() {
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, YT_DLP_FILE);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1_000_000) {
    await download(YT_DLP_URL, dest);
    if (!isWin) fs.chmodSync(dest, 0o755);
  }
  return dest;
}

// ffmpeg-static exporta la ruta absoluta al binario incluido en node_modules.
export function getFfmpegPath() {
  if (!ffmpegStatic) throw new Error('No se encontro el binario de ffmpeg (ffmpeg-static)');
  return ffmpegStatic;
}
