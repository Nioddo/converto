import { NextResponse } from 'next/server';
import { resolveTracks } from '@/lib/audio';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Traduce los errores tecnicos de Spotify a mensajes claros.
function friendly(msg) {
  if (msg === 'SPOTIFY_BAD_URL')
    return 'Ese link de Spotify no parece una playlist, álbum o tema.';
  if (msg === 'SPOTIFY_EMBED_404')
    return 'No encontré esa playlist/álbum de Spotify. Revisá el link.';
  if (msg && msg.startsWith('SPOTIFY_EMBED_'))
    return 'No pude leer esa playlist de Spotify (' + msg.replace('SPOTIFY_EMBED_', 'HTTP ') + '). Asegurate de que sea pública.';
  if (msg === 'SPOTIFY_PARSE' || msg === 'SPOTIFY_EMPTY')
    return 'No pude leer las canciones de esa playlist. Tiene que ser PÚBLICA. Ojo: las playlists creadas por Spotify (Top 50, Descubrimiento semanal, mixes) muchas veces no se pueden leer; usá una playlist tuya o de otro usuario.';
  return msg || 'Error resolviendo el link.';
}

export async function POST(req) {
  try {
    const { input, mode } = await req.json();
    if (!input || !String(input).trim()) {
      return NextResponse.json({ error: 'Pegá al menos un link.' }, { status: 400 });
    }
    const tracks = await resolveTracks(input, mode === 'playlist' ? 'playlist' : 'single');
    if (!tracks.length) {
      return NextResponse.json(
        { error: 'No encontré temas en ese link. Revisá que sea un video/playlist de YouTube o una playlist de Spotify pública.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ tracks });
  } catch (err) {
    return NextResponse.json({ error: friendly(err?.message) }, { status: 400 });
  }
}
