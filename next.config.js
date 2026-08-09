/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static trae un binario: no lo empaquetamos, lo dejamos en node_modules
  // para que la ruta que devuelve require('ffmpeg-static') siga siendo valida.
  serverExternalPackages: ['ffmpeg-static'],
  // Aseguramos que el binario de ffmpeg viaje dentro de la funcion serverless en Vercel.
  outputFileTracingIncludes: {
    '/api/convert': ['./node_modules/ffmpeg-static/**'],
  },
};

module.exports = nextConfig;
