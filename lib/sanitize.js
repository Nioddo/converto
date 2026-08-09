// Limpia el titulo de un video para usarlo como nombre de archivo.
// - saca tildes/diacriticos, enie -> n, elimina emojis/simbolos
// - deja solo letras/numeros ASCII, espacios y guiones; recorta a 80
function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9 \-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || 'audio';
}

module.exports = { sanitizeFilename };
