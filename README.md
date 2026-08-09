# 🎧 Converto

App de escritorio para Windows que convierte **videos/playlists de YouTube** y **playlists de Spotify** a
**MP3 320 kbps (CBR)** o **FLAC**, con archivos **sin metadatos, sin etiquetas ID3 y sin carátula**, y con
**nombres limpios** (sin tildes, ñ, emojis ni símbolos). Pensada para reproductores MP3 básicos —como los de
auriculares de conducción ósea— que se cuelgan cuando el archivo trae imágenes o tags.

La conversión es **real**: baja el mejor audio con `yt-dlp` y lo **recodifica con `ffmpeg`** (no renombra archivos).

---

## 📥 Instalar (para usar, sin comandos)

1. Andá a la sección **[Releases](https://github.com/Nioddo/converto/releases)** del repo.
2. Descargá el archivo **`Converto-Setup-x.x.x.exe`**.
3. Doble clic para instalar. Como no está firmado con un certificado pago, Windows puede mostrar
   *"Windows protegió tu PC"* → tocá **Más información → Ejecutar de todas formas**.
4. Se crea un acceso directo en el escritorio y en el menú de inicio. **Doble clic y listo.**

> La primera vez que convertís algo, la app descarga sola su motor de descarga (`yt-dlp`, unos segundos).
> Necesitás conexión a internet para descargar y convertir.

## ▶️ Cómo se usa

1. Pegá uno o más links (YouTube o Spotify), un por línea.
2. Elegí el formato (**MP3 320** o **FLAC**) y, si querés, dejá activado el identificador de voz por defecto.
3. Tocá **Buscar temas**: aparece la lista.
4. En cada tema podés prender/apagar el **🔊 identificador de voz** y **escribir el texto** que quieras que lea
   (por defecto lee el título).
5. Tocá **Procesar y guardar**: elegís una carpeta (puede ser el **pendrive o los auriculares**) y se guarda
   cada archivo ahí, suelto, listo para copiar.

---

## Características

- **YouTube**: video suelto, o playlist completa (con opción de traer solo el tema aunque el link tenga `&list=`).
- **Spotify**: playlist / álbum / tema. Como Spotify no deja bajar audio, lee la lista (página pública de Spotify)
  y **busca y baja cada tema desde YouTube**. Sin credenciales.
  - Límites de Spotify: la playlist debe ser **pública**, se leen hasta **~100 temas**, y las playlists creadas
    por Spotify (Top 50, mixes) normalmente no se pueden leer. Usá playlists tuyas o de otros usuarios.
- **Sin metadatos ni carátula**: `ffmpeg -vn -map 0:a:0 -map_metadata -1 -map_chapters -1`; MP3 con
  `-id3v2_version 0 -write_id3v1 0`.
- **Identificador de voz** (opcional, por tema): una voz lee el título (o tu texto) 2-5 s, **embebido en el mismo
  archivo** sin perder calidad de la música (una sola recodificación; FLAC queda en 24-bit igual que sin voz).
- **Nombres limpios**: NFD + saca acentos, ñ→n, elimina emojis/símbolos, recorta a 80 caracteres.

---

## 🛠️ Para desarrolladores (compilar desde el código)

Requisitos: Node.js.

```bash
npm install        # instala dependencias (Electron, ffmpeg-static, empaquetador)
npm start          # abre la app en modo desarrollo
npm run dist       # genera el instalador en dist/  (Converto-Setup-x.x.x.exe)
```

Estructura:

```
electron/
  main.js       proceso principal (ventana + descarga/convierte/guarda)
  preload.js    puente seguro hacia la interfaz
public/
  index.html    interfaz
  app.js        lógica de la interfaz
  style.css     estilos
lib/
  audio.js      yt-dlp + ffmpeg (y mezcla del identificador)
  binaries.js   ubica/descarga yt-dlp; ruta de ffmpeg
  spotify.js    lee la lista de una playlist/álbum de Spotify (sin credenciales)
  tts.js        identificador de voz (Google TTS)
  sanitize.js   limpieza de nombres de archivo
```

`ffmpeg` viene de `ffmpeg-static` (empaquetado). `yt-dlp` se descarga solo a una carpeta del usuario la primera vez.

## Solo para uso personal

Descargá únicamente contenido que tengas derecho a usar.
