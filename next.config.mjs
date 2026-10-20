import './scripts/patch-fs.cjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permite validar builds em diretório isolado quando o servidor local mantém .next bloqueado no Windows.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: (config) => {
    // Desabilita cache de arquivos para compatibilidade total com FAT32
    config.cache = false;
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
