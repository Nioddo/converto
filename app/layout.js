import './globals.css';

export const metadata = {
  title: 'Converto — YouTube a MP3/FLAC sin metadatos',
  description:
    'Convierte videos y playlists de YouTube a MP3 320 kbps o FLAC, sin metadatos ni caratulas, listos para reproductores MP3 basicos.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
