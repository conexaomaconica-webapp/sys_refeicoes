import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sistema de Refeições | Antigravity Platform',
  description: 'Controle de acesso, recarga e consumo de refeições universitárias',
  applicationName: 'SysRefeições',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SysRefeições',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0d1b2a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
