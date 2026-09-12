const $ = (id) => document.getElementById(id);

const state = {
  mode: 'single',
  format: 'mp3',
  defaultId: true,
  tracks: [], // { title, url, speech, idOn, idText, els }
  busy: false,
};

// --- selectores tipo "tarjeta" (modo y formato) ---
function wireCards(containerId, dataKey, onPick) {
  const cont = $(containerId);
  cont.querySelectorAll('.fmt').forEach((el) => {
    el.addEventListener('click', () => {
      if (state.busy) return;
      cont.querySelectorAll('.fmt').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      onPick(el.dataset[dataKey]);
    });
  });
}
wireCards('mode', 'mode', (v) => (state.mode = v));
wireCards('format', 'format', (v) => (state.format = v));
$('defaultId').addEventListener('change', (e) => (state.defaultId = e.target.checked));

// --- banner ---
function showBanner(type, msg) {
  const b = $('banner');
  b.className = `banner ${type}`;
  b.textContent = msg;
  b.classList.remove('hidden');
}
function hideBanner() {
  $('banner').classList.add('hidden');
}

// traduce errores tecnicos de Spotify a algo legible
function friendly(msg) {
  const m = String(msg || '');
  if (m.includes('SPOTIFY_EMPTY') || m.includes('SPOTIFY_PARSE'))
    return 'No pude leer las canciones de esa playlist. Tiene que ser PÚBLICA. Ojo: las playlists creadas por Spotify (Top 50, mixes) no se pueden leer; usá una playlist tuya o de otro usuario.';
  if (m.includes('SPOTIFY_EMBED_404')) return 'No encontré esa playlist/álbum de Spotify. Revisá el link.';
  if (m.includes('SPOTIFY_EMBED_')) return 'No pude leer esa playlist de Spotify. Asegurate de que sea pública.';
  if (m.includes('SPOTIFY_BAD_URL')) return 'Ese link de Spotify no parece una playlist, álbum o tema.';
  // limpiar el prefijo "Error invoking remote method ..."
  const i = m.indexOf('Error: ');
  return i >= 0 ? m.slice(i + 7) : m;
}

// --- Paso 1: buscar ---
async function search() {
  const input = $('input').value.trim();
  if (!input || state.busy) return;
  setBusy(true);
  hideBanner();
  $('tracksCard').classList.add('hidden');
  $('searchBtn').textContent = 'Buscando…';
  try {
    const tracks = await window.api.resolve(input, state.mode);
    state.tracks = tracks.map((t) => ({ ...t, idOn: state.defaultId, idText: '' }));
    renderTracks();
    showBanner('ok', `Encontré ${state.tracks.length} tema(s). Revisá el identificador de cada uno y tocá "Procesar y guardar".`);
  } catch (err) {
    showBanner('err', friendly(err.message));
  }
  $('searchBtn').textContent = 'Buscar temas';
  setBusy(false);
}

function renderTracks() {
  const ul = $('tracks');
  ul.innerHTML = '';
  $('tracksTitle').textContent = `Temas (${state.tracks.length})`;
  state.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'trow';

    const dot = document.createElement('span');
    dot.className = 'dot';

    const title = document.createElement('span');
    title.className = 'title';
    title.title = t.title;
    title.textContent = t.title;

    const toggle = document.createElement('label');
    toggle.className = 'idtoggle';
    toggle.title = 'Leer el título con voz';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.idOn;
    const spk = document.createElement('span');
    spk.textContent = '🔊';
    toggle.appendChild(cb);
    toggle.appendChild(spk);

    const txt = document.createElement('input');
    txt.className = 'idtext';
    txt.type = 'text';
    txt.value = t.idText;
    txt.placeholder = t.idOn ? (t.speech || t.title) : 'sin voz';
    txt.disabled = !t.idOn;

    const st = document.createElement('span');
    st.className = 'state';

    cb.addEventListener('change', () => {
      t.idOn = cb.checked;
      txt.disabled = !t.idOn;
      txt.placeholder = t.idOn ? (t.speech || t.title) : 'sin voz';
    });
    txt.addEventListener('input', () => (t.idText = txt.value));

    li.append(dot, title, toggle, txt, st);
    ul.appendChild(li);
    t.els = { dot, st };
  });
  $('tracksCard').classList.remove('hidden');
}

function setStatus(t, status) {
  if (!t.els) return;
  t.els.dot.className = 'dot' + (status ? ' ' + status : '');
  t.els.st.textContent = status === 'done' ? '✓' : status === 'doing' ? '…' : status === 'failed' ? 'error' : '';
}

$('allOn').addEventListener('click', () => setAll(true));
$('allOff').addEventListener('click', () => setAll(false));
function setAll(on) {
  if (state.busy) return;
  state.tracks.forEach((t) => (t.idOn = on));
  renderTracks();
}

// --- Paso 2: procesar ---
async function process() {
  if (!state.tracks.length || state.busy) return;

  const folder = await window.api.pickFolder();
  if (!folder) {
    showBanner('err', 'No elegiste carpeta. Tocá "Procesar y guardar" de nuevo y elegí dónde guardar.');
    return;
  }

  setBusy(true);
  hideBanner();
  const bar = $('bar');
  $('barWrap').classList.remove('hidden');
  bar.style.width = '0%';
  state.tracks.forEach((t) => setStatus(t, ''));

  let ok = 0;
  let failed = 0;
  let firstError = '';
  for (let i = 0; i < state.tracks.length; i++) {
    const t = state.tracks[i];
    setStatus(t, 'doing');
    $('processBtn').textContent = `Procesando ${i + 1}/${state.tracks.length}…`;
    try {
      await window.api.convert(
        { url: t.url, title: t.title, idOn: t.idOn, idText: t.idText },
        state.format,
      );
      setStatus(t, 'done');
      ok++;
    } catch (err) {
      console.error(`[Converto] Falló "${t.title}":`, err);
      if (!firstError) firstError = friendly(err.message);
      setStatus(t, 'failed');
      failed++;
    }
    bar.style.width = `${Math.round(((i + 1) / state.tracks.length) * 100)}%`;
  }

  $('processBtn').textContent = 'Procesar y guardar';
  if (ok > 0) {
    showBanner('ok', `Listo: guardé ${ok} archivo(s) en la carpeta${failed ? ` · ${failed} fallaron` : ''}. Ya están sueltos, listos para copiar.`);
    window.api.openFolder();
  } else {
    showBanner('err', firstError || 'No se pudo convertir ningún tema. Revisá tu conexión y volvé a intentar.');
  }
  setBusy(false);
}

function setBusy(b) {
  state.busy = b;
  ['searchBtn', 'processBtn', 'input', 'defaultId', 'allOn', 'allOff'].forEach((id) => ($(id).disabled = b));
  document.querySelectorAll('.idtoggle input').forEach((el) => (el.disabled = b));
  // el campo de texto queda deshabilitado si estamos ocupados o si ese tema no tiene voz
  document.querySelectorAll('#tracks .idtext').forEach((el, idx) => {
    el.disabled = b || !(state.tracks[idx] && state.tracks[idx].idOn);
  });
}

$('searchBtn').addEventListener('click', search);
$('processBtn').addEventListener('click', process);
