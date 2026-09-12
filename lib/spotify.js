// Lee la lista de temas de una playlist / album / track de Spotify SIN credenciales,
// usando la pagina publica de "embed". Devuelve [{ title, query }].
// Limites: la playlist debe ser PUBLICA; muestra hasta 200 temas; las playlists
// creadas por Spotify (Top 50, mixes) normalmente no incrustan la lista.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function isSpotifyUrl(u) {
  return /open\.spotify\.com\//i.test(u) || /^spotify:/i.test(u);
}

function parseSpotify(url) {
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  const u = url.match(/^spotify:(playlist|album|track):([A-Za-z0-9]+)/i);
  if (u) return { type: u[1].toLowerCase(), id: u[2] };
  return null;
}

function findTrackList(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14) return null;
  if (Array.isArray(obj.trackList)) return obj.trackList;
  for (const k of Object.keys(obj)) {
    const r = findTrackList(obj[k], depth + 1);
    if (r) return r;
  }
  return null;
}

// Convierte un item a { title, query }. Maneja playlist/album (title/subtitle) y track (name/artists).
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchApiPage(type, id, token, offset) {
  const limit = type === 'album' ? 50 : 100;
  const resource = type === 'album' ? 'albums' : 'playlists';
  const suffix = type === 'album' ? 'tracks' : 'tracks';
  const url = `https://api.spotify.com/v1/${resource}/${id}/${suffix}?limit=${limit}&offset=${offset}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return res.json();
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.status !== 429 || attempt > 0 || !Number.isFinite(retryAfter) || retryAfter > 10) return null;
    await delay(Math.max(1, retryAfter) * 1_000);
  }
  return null;
}

async function expandTrackList(parsed, data, initialList) {
  if (!['playlist', 'album'].includes(parsed.type) || initialList.length < 100) return initialList;
  const token = data?.props?.pageProps?.state?.settings?.session?.accessToken;
  if (!token) return initialList;

  const expanded = [...initialList];
  try {
    while (expanded.length < 200) {
      const page = await fetchApiPage(parsed.type, parsed.id, token, expanded.length);
      if (!page || !Array.isArray(page.items) || !page.items.length) break;
      const items = parsed.type === 'playlist'
        ? page.items.map((item) => item && item.track).filter(Boolean)
        : page.items;
      expanded.push(...items);
      if (!page.next) break;
    }
  } catch {
    return initialList;
  }
  return expanded.slice(0, 200);
}

async function fetchEmbed(embedUrl) {
  let lastStatus = 'ERR';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(embedUrl, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    } catch {
      continue;
    }
    if (res.ok) return res.text();
    lastStatus = res.status;
    if (res.status < 500) break;
  }
  throw new Error(`SPOTIFY_EMBED_${lastStatus}`);
}

async function getSpotifyTracks(url) {
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

  let list = findTrackList(data);
  if (!list || !list.length) {
    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (entity && (entity.name || entity.title)) list = [entity];
  }
  if (!list || !list.length) throw new Error('SPOTIFY_EMPTY');
  list = await expandTrackList(parsed, data, list);

  const out = list.map(toTrack).filter(Boolean);
  if (!out.length) throw new Error('SPOTIFY_EMPTY');
  return out;
}

module.exports = { isSpotifyUrl, getSpotifyTracks };
