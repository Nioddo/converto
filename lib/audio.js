const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { getYtDlpPath, getFfmpegPath, getDenoPath } = require('./binaries');
const { fetchTts, cleanTitleForSpeech } = require('./tts');
const { isSpotifyUrl, getSpotifyTracks } = require('./spotify');

// Carpeta temporal de trabajo. Electron define CONVERTO_WORK_DIR.
function getWorkRoot() {
  return process.env.CONVERTO_WORK_DIR || path.join(process.cwd(), '.work');
}

function ytDlpRuntimeArgs() {
  return ['--js-runtimes', `deno:${getDenoPath()}`];
}

const YT_DLP_DOWNLOAD_RELIABILITY_ARGS = [
  '--retries', '10',
  '--fragment-retries', '10',
  '--extractor-retries', '5',
  '--sleep-requests', '0.75',
  '--sleep-interval', '1',
  '--max-sleep-interval', '3',
];

// Ejecuta un binario y junta stdout/stderr. Rechaza si el codigo de salida != 0.
function run(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, signal });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout).slice(-1500) || `Proceso termino con codigo ${code}`));
    });
  });
}

// Expande un input a [{ title, url, speech }].
//  - Spotify (playlist/album/track): busca cada tema en YouTube (url = "ytsearch1:...").
//  - YouTube: mode 'single' (ignora &list=) o 'playlist' (expande la lista).
async function resolveTracks(input, mode = 'single') {
  const parts = [...new Set(String(input || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean))];

  const tracks = [];
  let ytdlp = null;

  for (const part of parts) {
    if (isSpotifyUrl(part)) {
      const spTracks = await getSpotifyTracks(part);
      for (const t of spTracks) {
        tracks.push({
          title: t.title,
          url: `ytsearch1:${t.query}`,
          speech: cleanTitleForSpeech(t.title),
          sourceId: t.spotifyId ? `spotify:${t.spotifyId}` : `spotify-query:${t.query.toLocaleLowerCase()}`,
        });
      }
      continue;
    }

    if (!ytdlp) ytdlp = await getYtDlpPath();
    const args =
      mode === 'playlist'
        ? [...ytDlpRuntimeArgs(), '--yes-playlist', '--flat-playlist', '--ignore-errors', '--no-warnings', '-J', part]
        : [...ytDlpRuntimeArgs(), '--no-playlist', '--ignore-errors', '--no-warnings', '-J', part];
    const { stdout } = await run(ytdlp, args);
    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      continue;
    }
    const entries = Array.isArray(data.entries) ? data.entries : [data];
    for (const e of entries) {
      if (!e) continue;
      const id = e.id || '';
      const url =
        e.webpage_url ||
        (e.url && String(e.url).startsWith('http')
          ? e.url
          : id
          ? `https://www.youtube.com/watch?v=${id}`
          : null);
      if (!url) continue;
      const title = e.title || id || 'audio';
      tracks.push({ title, url, speech: cleanTitleForSpeech(title), sourceId: id ? `youtube:${id}` : url });
    }
  }
  const seen = new Set();
  return tracks.filter((track) => {
    const key = track.sourceId || track.url || track.title.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function codecArgs(isFlac) {
  return isFlac
    ? ['-c:a', 'flac']
    : ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '0', '-write_id3v1', '0'];
}
const STRIP_ARGS = ['-map_metadata', '-1', '-map_chapters', '-1'];

async function findSearchCandidates(ytdlp, searchUrl, signal) {
  const query = String(searchUrl).replace(/^ytsearch\d*:/, '');
  const { stdout } = await run(ytdlp, [
    ...ytDlpRuntimeArgs(),
    '--flat-playlist',
    '--playlist-end', '5',
    '--ignore-errors',
    '--no-warnings',
    '-J',
    `ytsearch5:${query}`,
  ], signal);
  const data = JSON.parse(stdout);
  return (Array.isArray(data.entries) ? data.entries : [])
    .filter((entry) => {
      const duration = Number(entry?.duration || 0);
      return entry?.id && entry.live_status !== 'is_live' && (!duration || duration <= 20 * 60);
    })
    .map((entry) => `https://www.youtube.com/watch?v=${entry.id}`);
}

async function downloadSource(ytdlp, url, template, jobDir, signal) {
  const isSearch = String(url).startsWith('ytsearch');
  let candidates = [url];
  if (isSearch) {
    try {
      const found = await findSearchCandidates(ytdlp, url, signal);
      if (found.length) candidates = found;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
    }
  }

  let lastError;
  for (const candidate of candidates) {
    for (const file of await fsp.readdir(jobDir)) {
      if (file.startsWith('src.')) await fsp.rm(path.join(jobDir, file), { force: true });
    }
    try {
      await run(ytdlp, [
        ...ytDlpRuntimeArgs(),
        ...YT_DLP_DOWNLOAD_RELIABILITY_ARGS,
        '-f', 'bestaudio/best',
        '--no-embed-metadata',
        '--no-embed-thumbnail',
        '--no-write-thumbnail',
        '--no-warnings',
        '--no-playlist',
        '-o', template,
        candidate,
      ], signal);
      return;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('No se encontró una versión disponible del tema en YouTube');
}

// Descarga el mejor audio y lo recodifica SIN metadatos ni caratula.
// opts: { url, title, format: 'mp3'|'flac', identifier, identifierText }
// url puede ser link normal o busqueda "ytsearch1:...".
// Devuelve { buffer, ext, mime }.
async function convertTrack({ url, title, format, identifier, identifierText, outputPath, signal }) {
  const ytdlp = await getYtDlpPath();
  const ffmpeg = getFfmpegPath();
  const workRoot = getWorkRoot();
  await fsp.mkdir(workRoot, { recursive: true });
  const jobDir = await fsp.mkdtemp(path.join(workRoot, 'job-'));

  try {
    const template = path.join(jobDir, 'src.%(ext)s');
    await downloadSource(ytdlp, url, template, jobDir, signal);

    const srcName = (await fsp.readdir(jobDir)).find((f) => f.startsWith('src.'));
    if (!srcName) throw new Error('No se pudo descargar el audio');
    const srcPath = path.join(jobDir, srcName);

    const isFlac = format === 'flac';
    const ext = isFlac ? 'flac' : 'mp3';
    const outPath = path.join(jobDir, `out.${ext}`);

    let ttsPath = null;
    if (identifier) {
      try {
        const custom = String(identifierText || '').trim();
        const spoken = custom ? custom.slice(0, 90) : cleanTitleForSpeech(title);
        const ttsBuf = await fetchTts(spoken, 'es');
        if (ttsBuf && ttsBuf.length > 500) {
          ttsPath = path.join(jobDir, 'tts.mp3');
          await fsp.writeFile(ttsPath, ttsBuf);
        }
      } catch {
        ttsPath = null;
      }
    }

    if (ttsPath) {
      const af = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
      const fc =
        `[0:a]${af}[t];` +
        `[1:a]${af}[s];` +
        `[2:a]${af}[m];` +
        '[t][s][m]concat=n=3:v=0:a=1[a]';
      await run(ffmpeg, [
        '-y',
        '-i', ttsPath,
        '-f', 'lavfi', '-t', '0.4', '-i', 'anullsrc=r=44100:cl=stereo',
        '-i', srcPath,
        '-filter_complex', fc,
        '-map', '[a]',
        ...STRIP_ARGS,
        ...codecArgs(isFlac),
        outPath,
      ], signal);
    } else {
      await run(ffmpeg, [
        '-y',
        '-i', srcPath,
        '-vn',
        '-map', '0:a:0',
        ...STRIP_ARGS,
        '-ar', '44100',
        '-ac', '2',
        ...codecArgs(isFlac),
        outPath,
      ], signal);
    }

    const mime = isFlac ? 'audio/flac' : 'audio/mpeg';
    if (outputPath) {
      await fsp.copyFile(outPath, outputPath);
      return { ext, mime };
    }
    const buffer = await fsp.readFile(outPath);
    return { buffer, ext, mime };
  } finally {
    try { await fsp.rm(jobDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

module.exports = { resolveTracks, convertTrack };
