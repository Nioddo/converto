'use client';

import { useState } from 'react';
import JSZip from 'jszip';

const FORMATS = [
  { id: 'mp3', name: 'MP3 · 320 kbps', desc: 'Compatible con casi todo. CBR.' },
  { id: 'flac', name: 'FLAC', desc: 'Sin perdida. Archivos mas grandes.' },
];

export default function Home() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('single'); // 'single' | 'playlist' (para links de YouTube con lista)
  const [format, setFormat] = useState('mp3');
  const [defaultId, setDefaultId] = useState(true); // identificador por defecto en los temas encontrados

  const [tracks, setTracks] = useState([]); // { title, url, speech, idOn, idText, status, error }
  const [searching, setSearching] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [banner, setBanner] = useState(null); // { type, msg }

  const patchTrack = (i, patch) =>
    setTracks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const setAllId = (on) => setTracks((prev) => prev.map((t) => ({ ...t, idOn: on })));

  // Paso 1: buscar / resolver los temas
  async function handleSearch() {
    if (!input.trim() || searching || running) return;
    setSearching(true);
    setBanner(null);
    setTracks([]);
    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo leer el link.');
      const list = data.tracks.map((t) => ({
        ...t,
        idOn: defaultId,
        idText: '',
        status: 'pending',
        error: null,
      }));
      setTracks(list);
      setBanner({ type: 'ok', msg: `Encontré ${list.length} tema(s). Revisá el identificador de cada uno y tocá "Procesar".` });
    } catch (err) {
      setBanner({ type: 'err', msg: err.message });
    }
    setSearching(false);
  }

  // Paso 2: convertir y descargar
  async function handleProcess() {
    if (!tracks.length || running || searching) return;
    setRunning(true);
    setBanner(null);

    const items = tracks.map((t) => ({ ...t, status: 'pending', error: null }));
    setTracks(items);
    setProgress({ done: 0, total: items.length });

    // Cómo guardar (evita quedarnos sin memoria con playlists grandes):
    //  - 1 tema   -> descarga directa.
    //  - varios   -> si el navegador puede elegir carpeta (Chrome/Edge), escribimos cada
    //                archivo directo en la carpeta a medida que se convierte (sin ZIP,
    //                liberando la memoria de cada uno). Si no, ZIP como respaldo.
    const canFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    let dirHandle = null;
    if (items.length > 1 && canFolder) {
      try {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        setBanner({ type: 'err', msg: 'No elegiste carpeta. Tocá "Procesar y descargar" de nuevo y elegí dónde guardar (puede ser el pendrive o los auriculares).' });
        setRunning(false);
        return;
      }
    }

    const zip = items.length > 1 && !dirHandle ? new JSZip() : null;
    const usedNames = new Set();
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      patchTrack(i, { status: 'doing' });
      try {
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: items[i].url,
            title: items[i].title,
            format,
            identifier: items[i].idOn,
            identifierText: items[i].idText,
          }),
        });
        if (!res.ok) {
          let msg = 'Error';
          try {
            msg = (await res.json()).error || msg;
          } catch { /* respuesta no-JSON */ }
          throw new Error(msg);
        }
        const blob = await res.blob();
        let name = decodeURIComponent(res.headers.get('X-Filename') || `audio-${i + 1}.${format}`);
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.');
          name = `${name.slice(0, dot)} (${i + 1})${name.slice(dot)}`;
        }
        usedNames.add(name);

        if (items.length === 1) {
          downloadBlob(blob, name);                       // archivo directo
        } else if (dirHandle) {
          await writeFileToDir(dirHandle, name, blob);    // a la carpeta (y se libera)
        } else {
          zip.file(name, blob);                           // respaldo ZIP
        }
        ok++;
        patchTrack(i, { status: 'done' });
      } catch (err) {
        patchTrack(i, { status: 'failed', error: err.message });
        failed++;
      }
      setProgress({ done: i + 1, total: items.length });
    }

    if (ok === 0) {
      setBanner({
        type: 'err',
        msg: 'No se pudo convertir ningún tema. Si estás en Vercel, puede ser YouTube bloqueando la IP del servidor: probá corriendo la app en tu PC con "npm run dev".',
      });
    } else if (items.length === 1) {
      setBanner({ type: 'ok', msg: 'Listo: se descargó el archivo. Ya podés copiarlo a los auriculares.' });
    } else if (dirHandle) {
      setBanner({ type: 'ok', msg: `Listo: guardé ${ok} archivo(s) en la carpeta que elegiste${failed ? ` · ${failed} fallaron` : ''}. Están sueltos, listos para copiar.` });
    } else {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'converto-audios.zip');
      setBanner({
        type: 'ok',
        msg: `Listo: ${ok} archivo(s) en el ZIP${failed ? ` · ${failed} fallaron` : ''}. Al descomprimir salen sueltos (sin carpeta).`,
      });
    }

    setRunning(false);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function writeFileToDir(dirHandle, filename, blob) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const ws = await fh.createWritable();
    await ws.write(blob);
    await ws.close();
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const busy = searching || running;

  return (
    <main className="wrap">
      <header>
        <h1>🎧 Converto</h1>
        <p>
          Pegá links de <strong>YouTube</strong> (video o playlist) o una <strong>playlist de Spotify</strong>. Buscá
          los temas, elegí para cada uno si querés un <strong>identificador de voz</strong> (una voz lee el título), y
          descargá todo en MP3 320 o FLAC — <strong>sin metadatos ni carátulas</strong>, para reproductores MP3 básicos.
        </p>
      </header>

      <div className="card">
        <label className="block" htmlFor="input">
          Links (uno por línea) — YouTube o Spotify
        </label>
        <textarea
          id="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.youtube.com/playlist?list=...\nhttps://open.spotify.com/playlist/...'}
          disabled={busy}
        />

        <label className="block" style={{ marginTop: 20 }}>
          Si el link de YouTube tiene una lista pegada…
        </label>
        <div className="formats">
          <label className={`fmt ${mode === 'single' ? 'active' : ''}`}>
            <input type="radio" name="mode" checked={mode === 'single'} onChange={() => setMode('single')} disabled={busy} />
            <div className="name">Un solo tema</div>
            <div className="desc">Solo ese video, aunque el link tenga una lista.</div>
          </label>
          <label className={`fmt ${mode === 'playlist' ? 'active' : ''}`}>
            <input type="radio" name="mode" checked={mode === 'playlist'} onChange={() => setMode('playlist')} disabled={busy} />
            <div className="name">Lista completa</div>
            <div className="desc">Baja todos los temas de la playlist de YouTube.</div>
          </label>
        </div>

        <label className="block" style={{ marginTop: 20 }}>
          Formato
        </label>
        <div className="formats">
          {FORMATS.map((f) => (
            <label key={f.id} className={`fmt ${format === f.id ? 'active' : ''}`}>
              <input type="radio" name="format" checked={format === f.id} onChange={() => setFormat(f.id)} disabled={busy} />
              <div className="name">{f.name}</div>
              <div className="desc">{f.desc}</div>
            </label>
          ))}
        </div>

        <label className="checkline" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={defaultId} onChange={(e) => setDefaultId(e.target.checked)} disabled={busy} />
          <span>Activar el identificador de voz por defecto en los temas encontrados</span>
        </label>

        <button className="go" onClick={handleSearch} disabled={busy || !input.trim()}>
          {searching ? 'Buscando…' : 'Buscar temas'}
        </button>

        {banner && <div className={`banner ${banner.type}`}>{banner.msg}</div>}
      </div>

      {tracks.length > 0 && (
        <div className="card">
          <div className="tracks-head">
            <label className="block" style={{ margin: 0 }}>Temas ({tracks.length})</label>
            <div className="mini-btns">
              <button onClick={() => setAllId(true)} disabled={running}>Todos con voz</button>
              <button onClick={() => setAllId(false)} disabled={running}>Todos sin voz</button>
            </div>
          </div>

          <p className="hint">
            🔊 = incluir identificador de voz. El texto por defecto es el título; podés escribir otro.
          </p>

          <ul className="tracks">
            {tracks.map((t, i) => (
              <li key={i} className="trow">
                <span className={`dot ${t.status === 'doing' ? 'doing' : t.status === 'done' ? 'done' : t.status === 'failed' ? 'failed' : ''}`} />
                <span className="title" title={t.title}>{t.title}</span>
                <label className="idtoggle" title="Leer el título con voz">
                  <input type="checkbox" checked={t.idOn} onChange={(e) => patchTrack(i, { idOn: e.target.checked })} disabled={running} />
                  <span>🔊</span>
                </label>
                <input
                  className="idtext"
                  type="text"
                  value={t.idText}
                  placeholder={t.idOn ? (t.speech || t.title) : 'sin voz'}
                  onChange={(e) => patchTrack(i, { idText: e.target.value })}
                  disabled={running || !t.idOn}
                />
                <span className="state" title={t.status === 'failed' ? t.error : undefined}>
                  {t.status === 'done' ? '✓' : t.status === 'doing' ? '…' : t.status === 'failed' ? 'error' : ''}
                </span>
              </li>
            ))}
          </ul>

          <button className="go" onClick={handleProcess} disabled={running}>
            {running ? `Procesando ${progress.done}/${progress.total}…` : 'Procesar y descargar'}
          </button>

          {running && (
            <div className="bar">
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      <footer>
        Un tema se descarga solo; con varios (playlist) el navegador te pide <strong>elegir una carpeta</strong> y
        guarda cada archivo ahí a medida que convierte — podés elegir directo el pendrive o los auriculares. Los temas
        de Spotify se buscan y bajan desde YouTube. El identificador de voz usa el TTS de Google; si falla, el tema
        igual se convierte sin voz. (En Chrome/Edge se usa la carpeta; en otros navegadores, un ZIP.)
      </footer>
    </main>
  );
}
