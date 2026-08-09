// Lee la lista de temas de una playlist / album / track de Spotify SIN credenciales,
// usando la pagina publica de "embed" (la misma que Spotify permite incrustar).
// Devuelve [{ title: "Artista - Tema", query: "Artista Tema" }].
//
// Requisitos / limites:
//  - La playlist tiene que ser PUBLICA (las privadas no se pueden incrustar).
//  - El embed muestra hasta ~100 temas; playlists mas grandes pueden salir recortadas.
//  - Las playlists creadas por Spotify (Top 50, mixes) suelen no incrustar la lista.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export function isSpotifyUrl(u) {
  return /open\.spotify\.com\//i.test(u) || /^spotify:/i.test(u);
}

function parseSpotify(url) {
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  const u = url.match(/^spotify:(playlist|album|track):([A-Za-z0-9]+)/i);
  if (u) return { type: u[1].toLowerCase(), id: u[2] };
  return null;
}

// Busca recursivamente el array trackList dentro del JSON del embed.
function findTrackList(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14) return null;
  if (Array.isArray(obj.trackList)) return obj.trackList;
  for (const k of Object.keys(obj)) {
    const r = findTrackList(obj[k], depth + 1);
    if (r) return r;
  }
  return null;
}

// Convierte un item del embed a { title, query }. Maneja dos formas:
//  - playlist/album: { title: tema, subtitle: artista }
//  - track suelto:   { name/title: tema, artists: [{name}] }
function toTrack(t) {
  const name = String(t.title || t.name || '').trim();
  if (!name) return null;
  let artist = String(t.subtitle || '').trim();
  if (!artist && Array.isArray(t.artists)) {
    artist = t.artists.map((a) => a && a.name).filter(Boolean).join(', ');
  }
  const title = artist ? `${artist} - ${name}` : name;
  const query = `${artist} ${name}`.trim();
  return { title, query };
}

// Descarga el HTML del embed con reintentos ante errores 5xx / de red.
async function fetchEmbed(embedUrl) {
  let lastStatus = 'ERR';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(embedUrl, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    } catch {
      continue; // hipo de red -> reintentar
    }
    if (res.ok) return res.text();
    lastStatus = res.status;
    if (res.status < 500) break; // 4xx no se reintenta
  }
  throw new Error(`SPOTIFY_EMBED_${lastStatus}`);
}

export async function getSpotifyTracks(url) {
  const parsed = parseSpotify(url);
  if (!parsed) throw new Error('SPOTIFY_BAD_URL');

  const html = await fetchEmbed(`https://open.spotify.com/embed/${parsed.type}/${parsed.id}`);
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('SPOTIFY_PARSE');

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('SPOTIFY_PARSE');
  }

  // playlist / album -> trackList; track suelto -> entidad unica
  let list = findTrackList(data);
  if (!list || !list.length) {
    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (entity && (entity.name || entity.title)) list = [entity];
  }
  if (!list || !list.length) throw new Error('SPOTIFY_EMPTY');

  const out = list.map(toTrack).filter(Boolean);
  if (!out.length) throw new Error('SPOTIFY_EMPTY');
  return out;
}
