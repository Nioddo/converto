import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getYtDlpPath, getFfmpegPath } from './binaries.js';
import { fetchTts, cleanTitleForSpeech } from './tts.js';
import { isSpotifyUrl, getSpotifyTracks } from './spotify.js';

const onVercel = !!process.env.VERCEL;
const workRoot = onVercel ? '/tmp/work' : path.join(process.cwd(), '.work');

// Ejecuta un binario y junta stdout/stderr. Rechaza si el codigo de salida != 0.
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
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

// Expande un input a una lista de pistas { title, url, speech }.
// - Links de Spotify (playlist/album/track): trae la lista y cada tema queda como
//   una busqueda en YouTube (url = "ytsearch1:artista tema").
// - Links de YouTube: mode 'single' (ignora &list=) o 'playlist' (expande la lista).
export async function resolveTracks(input, mode = 'single') {
  const parts = String(input || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const tracks = [];
  let ytdlp = null;

  for (const part of parts) {
    // --- Spotify ---
    if (isSpotifyUrl(part)) {
      const spTracks = await getSpotifyTracks(part);
      for (const t of spTracks) {
        tracks.push({
          title: t.title,
          url: `ytsearch1:${t.query}`,
          speech: cleanTitleForSpeech(t.title),
        });
      }
      continue;
    }

    // --- YouTube ---
    if (!ytdlp) ytdlp = await getYtDlpPath();
    const args =
      mode === 'playlist'
        ? ['--yes-playlist', '--flat-playlist', '--ignore-errors', '--no-warnings', '-J', part]
        : ['--no-playlist', '--ignore-errors', '--no-warnings', '-J', part];
    const { stdout } = await run(ytdlp, args);
    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      continue; // si no devolvio JSON valido, salteamos ese input
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
      tracks.push({ title, url, speech: cleanTitleForSpeech(title) });
    }
  }
  return tracks;
}

// Codec + limpieza de metadatos segun formato.
function codecArgs(isFlac) {
  return isFlac
    ? ['-c:a', 'flac']
    : ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '0', '-write_id3v1', '0'];
}
const STRIP_ARGS = ['-map_metadata', '-1', '-map_chapters', '-1'];

// Descarga el mejor audio de una URL y lo recodifica SIN metadatos ni caratula.
// opts: { url, title, format: 'mp3'|'flac', identifier: boolean, identifierText?: string }
// url puede ser un link normal o una busqueda "ytsearch1:..." (temas de Spotify).
// Si identifier === true, antepone una voz que lee el titulo (2-5 s) en el MISMO archivo.
//   - identifierText: texto a leer; si viene vacio se usa el titulo limpio.
// La musica se recodifica una sola vez -> no pierde calidad respecto a no usar identificador.
// Devuelve { buffer, ext, mime }.
export async function convertTrack({ url, title, format, identifier, identifierText }) {
  const ytdlp = await getYtDlpPath();
  const ffmpeg = getFfmpegPath();
  fs.mkdirSync(workRoot, { recursive: true });
  const jobDir = fs.mkdtempSync(path.join(workRoot, 'job-'));

  try {
    // 1) Descargar el mejor audio disponible, sin incrustar metadatos ni miniatura.
    const isSearch = String(url).startsWith('ytsearch');
    const template = path.join(jobDir, 'src.%(ext)s');
    const dlArgs = [
      '-f', 'bestaudio/best',
      '--no-embed-metadata',
      '--no-embed-thumbnail',
      '--no-write-thumbnail',
      '--no-warnings',
      '-o', template,
    ];
    if (!isSearch) dlArgs.push('--no-playlist'); // en busquedas ytsearch no aplica
    dlArgs.push(url);
    await run(ytdlp, dlArgs);

    const srcName = fs.readdirSync(jobDir).find((f) => f.startsWith('src.'));
    if (!srcName) throw new Error('No se pudo descargar el audio');
    const srcPath = path.join(jobDir, srcName);

    const isFlac = format === 'flac';
    const ext = isFlac ? 'flac' : 'mp3';
    const outPath = path.join(jobDir, `out.${ext}`);

    // 2) Si corresponde, generar el identificador de voz (TTS).
    let ttsPath = null;
    if (identifier) {
      try {
        const custom = String(identifierText || '').trim();
        const spoken = custom ? custom.slice(0, 90) : cleanTitleForSpeech(title);
        const ttsBuf = await fetchTts(spoken, 'es');
        if (ttsBuf && ttsBuf.length > 500) {
          ttsPath = path.join(jobDir, 'tts.mp3');
          fs.writeFileSync(ttsPath, ttsBuf);
        }
      } catch {
        ttsPath = null; // si el TTS falla, seguimos sin identificador (no perdemos la cancion)
      }
    }

    // 3) Recodificacion REAL con ffmpeg, eliminando TODO metadato y caratula.
    if (ttsPath) {
      // voz + 0.4 s de silencio + musica, todo mezclado a nivel de audio y codificado una sola vez
      // Forzamos fltp (float) en las 3 entradas para que la musica conserve su
      // profundidad (FLAC 24-bit, igual que sin identificador) y para que concat
      // reciba el mismo formato en todas las pistas.
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
      ]);
    } else {
      await run(ffmpeg, [
        '-y',
        '-i', srcPath,
        '-vn',                 // sin video
        '-map', '0:a:0',       // SOLO la primera pista de audio (descarta caratula/portada)
        ...STRIP_ARGS,
        '-ar', '44100',
        '-ac', '2',
        ...codecArgs(isFlac),
        outPath,
      ]);
    }

    const buffer = fs.readFileSync(outPath);
    return { buffer, ext, mime: isFlac ? 'audio/flac' : 'audio/mpeg' };
  } finally {
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
