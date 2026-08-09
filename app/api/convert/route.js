import { NextResponse } from 'next/server';
import { convertTrack } from '@/lib/audio';
import { sanitizeFilename } from '@/lib/sanitize';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { url, title, format, identifier, identifierText } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'Falta la URL del video.' }, { status: 400 });
    }
    const fmt = format === 'flac' ? 'flac' : 'mp3';
    const { buffer, ext, mime } = await convertTrack({
      url,
      title,
      format: fmt,
      identifier: !!identifier,
      identifierText,
    });
    const filename = `${sanitizeFilename(title)}.${ext}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
        // el nombre "seguro" va aparte para que el frontend lo use en el ZIP
        'X-Filename': encodeURIComponent(filename),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Error convirtiendo el audio.' }, { status: 500 });
  }
}
