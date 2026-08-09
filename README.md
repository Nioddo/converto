# 🎧 Converto

Convierte **videos y playlists de YouTube** a **MP3 320 kbps (CBR)** o **FLAC**, con una regla clave:
los archivos salen **sin metadatos, sin etiquetas ID3 y sin carátula/portada**, y con **nombres de archivo
limpios** (sin tildes, sin ñ, sin emojis ni símbolos). Ideal para reproductores MP3 básicos —como los de
auriculares de conducción ósea— que se cuelgan cuando el archivo trae imágenes o tags.

La conversión es **real**: se baja el mejor audio con `yt-dlp` y se **recodifica con `ffmpeg`** (no se
renombra un `.m4a`/`.webm`).

---

## Cómo usarla en tu PC (recomendado y más confiable)

Requisitos: solo **Node.js** (ya lo tenés). `ffmpeg` y `yt-dlp` se resuelven solos.

1. Abrí una terminal en esta carpeta.
2. Instalá las dependencias (una sola vez):

   ```bash
   npm install
   ```

3. Arrancá la app:

   ```bash
   npm run dev
   ```

4. Abrí el navegador en **http://localhost:3000**
5. Pegá uno o más links de YouTube (un video o una playlist), elegí **MP3** o **FLAC**, y tocá **Procesar**.
   Se convierte pista por pista y al final se descarga un **.zip** con todo.
6. Conectá los auriculares por USB y copiá los archivos del ZIP.

> La primera vez, `yt-dlp` se descarga automáticamente (unos segundos) y queda guardado en `.bin/`.

---

## Desplegar en Vercel (URL pública)

```bash
npm i -g vercel   # una sola vez
vercel            # seguí los pasos; luego "vercel --prod"
```

⚠️ **Aviso honesto sobre Vercel:** YouTube suele **bloquear las IPs de servidores en la nube** con un
"confirmá que no sos un robot". Cuando eso pasa, las descargas fallan aunque el código esté perfecto.
Además cada conversión tiene ~60 s de límite. Por eso la app procesa **una canción por request** y arma
el ZIP en el navegador. Si en Vercel te fallan las descargas, **usá la versión local** (`npm run dev`):
es exactamente la misma app y ahí sí funciona porque usa tu conexión de casa.

---

## Qué hace exactamente con el audio

Para cada pista, después de bajar el mejor audio, corre ffmpeg así:

- **MP3:** `-c:a libmp3lame -b:a 320k` (CBR) · `-id3v2_version 0 -write_id3v1 0` (sin tags)
- **FLAC:** `-c:a flac`
- En ambos: `-vn -map 0:a:0 -map_metadata -1 -map_chapters -1` → **solo la pista de audio**, sin portada,
  sin metadatos, sin capítulos.

Y el nombre del archivo pasa por una limpieza: NFD + borrado de acentos, ñ→n, se eliminan emojis y símbolos,
quedan solo letras/números/espacios/guiones y se recorta a 80 caracteres.

---

## Flujo de uso (dos pasos)

1. Pegá los links (YouTube o Spotify), elegí formato y si querés identificador por defecto, y tocá **Buscar temas**.
2. Aparece la lista de temas. En cada uno podés prender/apagar el **identificador de voz** (🔊) y escribir un
   texto distinto al título. Después tocá **Procesar y descargar**.

**Cómo se guarda:** un solo tema se descarga directo. Con varios (playlist), en Chrome/Edge el navegador te pide
**elegir una carpeta** y va escribiendo cada archivo ahí a medida que convierte (podés elegir directo el pendrive o
los auriculares); así no se llena la memoria del navegador aunque la playlist sea grande. En otros navegadores
(Firefox/Safari) cae a un **ZIP** con los archivos sueltos, pero para playlists muy grandes conviene Chrome/Edge.

---

## Spotify

Podés pegar el link de una **playlist, álbum o tema de Spotify**. Como Spotify no deja bajar el audio, la app
lee la lista (usando la página pública de *embed* de Spotify) y después **busca y baja cada tema desde YouTube**.
**No hacen falta credenciales ni nada que configurar.**

> ⚠️ Límites: la playlist tiene que ser **pública**, se leen hasta **~100 temas** (playlists más grandes pueden salir
> recortadas) y las playlists **creadas por Spotify** (Top 50, Descubrimiento semanal, mixes) normalmente no se pueden
> leer. Usá playlists **tuyas o de otros usuarios** y públicas.

---

## Identificador de voz (opcional)

Podés activar un **identificador de voz** que lee el título en voz alta (2-5 s) al empezar cada pista —
útil en reproductores sin pantalla. La voz se genera con el TTS de Google (español) y se **incrusta en el
mismo archivo**: se pega `voz + 0.4 s de silencio + música` a nivel de audio y se codifica **una sola vez**,
así que **la música no pierde nada de calidad** (MP3 sigue 320 kbps, FLAC sigue 24-bit). Se elige con el
selector "Con / Sin identificador".

Si el TTS de Google no responde (por ejemplo, IP bloqueada en la nube), la pista se convierte igual pero
**sin** el identificador, para no perder la canción.

---

## Estructura del proyecto

```
app/
  layout.js              layout raíz
  page.js                interfaz (pegar links, elegir formato, progreso, ZIP)
  globals.css            estilos
  api/
    resolve/route.js     expande un link a lista de pistas (playlists incluidas)
    convert/route.js     baja + recodifica una pista y la devuelve
lib/
  audio.js               lógica de yt-dlp + ffmpeg (y mezcla del identificador)
  binaries.js            ubica/descarga yt-dlp y ffmpeg
  sanitize.js            limpieza de nombres de archivo
  tts.js                 identificador de voz (Google TTS)
  spotify.js             lee la lista de una playlist/álbum de Spotify (sin credenciales)
next.config.js           config (ffmpeg-static externo + tracing)
vercel.json              límite de 60 s por función
```

## Solo para uso personal

Descargá únicamente contenido que tengas derecho a usar. Esta herramienta es para pasar tu propia música
a un reproductor básico.
