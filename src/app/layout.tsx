import type { Metadata, Viewport } from 'next';
import { BrandProvider } from '@/components/branding/BrandProvider';
import { PwaRegistration } from '@/components/pwa/PwaRegistration';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sistema de Refeições | Antigravity Platform',
  description: 'Controle de acesso, recarga e consumo de refeições universitárias',
  applicationName: 'SysRefeições',
  icons: {
    icon: '/icons/icon-192.png',
    shortcut: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SysRefeições',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
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
        <BrandProvider>
          <PwaRegistration />
          <main>{children}</main>
        </BrandProvider>
      </body>
    </html>
  );
}
