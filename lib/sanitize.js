// Limpia el titulo de un video para usarlo como nombre de archivo.
// Objetivo: que el reproductor MP3 basico no se cuelgue.
// - saca tildes/diacriticos (a e i o u con acento -> sin acento)
// - la enie (n con virgulilla) queda como "n"
// - elimina emojis, simbolos y cualquier caracter raro
// - deja solo letras/numeros ASCII, espacios y guiones
// - colapsa espacios y recorta a 80 caracteres
export function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .normalize('NFD')                        // separa letra + acento (enie -> n + virgulilla)
    .replace(/[̀-ͯ]/g, '')         // borra los acentos/diacriticos combinados
    .replace(/ß/g, 'ss')                // eszett aleman -> ss
    .replace(/[^A-Za-z0-9 \-]+/g, ' ')       // todo lo demas (emojis, simbolos, otros alfabetos) -> espacio
    .replace(/\s+/g, ' ')                    // colapsa espacios
    .trim()
    .slice(0, 80)
    .trim();

  return cleaned || 'audio';
}
