import https from 'node:https';

// Limpia el titulo para que la voz lea algo corto y natural (2-5 s).
// A diferencia del nombre de archivo, aca SI conservamos tildes y enie
// porque ayudan a la pronunciacion.
export function cleanTitleForSpeech(title) {
  let t = String(title || '')
    .replace(/\([^)]*\)/g, ' ')             // quita (Official Video) etc.
    .replace(/\[[^\]]*\]/g, ' ')            // quita [Lyrics] etc.
    .replace(/[^\p{L}\p{N} ,\-]+/gu, ' ')   // deja letras (con acento), numeros, espacio, coma, guion
    .replace(/\s+/g, ' ')
    .trim();

  // si al sacar los parentesis quedo vacio, usamos el titulo original limpio
  if (!t) {
    t = String(title || '')
      .replace(/[^\p{L}\p{N} ,\-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (t.length > 70) t = t.slice(0, 70).trim();
  return t || 'pista';
}

// Descarga un MP3 con el texto leido por voz (Google Translate TTS).
// lang: 'es' por defecto. Devuelve un Buffer.
export function fetchTts(text, lang = 'es') {
  const q = encodeURIComponent(text);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${q}`;
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('TTS HTTP ' + res.statusCode));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        },
      )
      .on('error', reject);
  });
}
