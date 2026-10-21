import './scripts/patch-fs.cjs';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

export default (phase) => {
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    // O Next 15 ainda não isola automaticamente a saída de desenvolvimento.
    // Separar os diretórios evita que build e dev removam manifests um do outro.
    distDir:
      process.env.NEXT_DIST_DIR ||
      (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
    reactStrictMode: true,
    poweredByHeader: false,
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

  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    nextConfig.webpack = (config) => {
      // Desabilita cache de arquivos para compatibilidade do build no Windows.
      config.cache = false;
      return config;
    };
  }

  return nextConfig;
};
