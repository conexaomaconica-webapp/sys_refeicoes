import type { Metadata } from 'next';
import { IntelligenceDemo } from '@/components/intelligence-demo/IntelligenceDemo';

export const metadata: Metadata = {
  title: 'Central de Inteligência · Demonstração | MA Refeições',
  description: 'Protótipo visual isolado da Central de Inteligência MA Refeições, com dados exclusivamente fictícios.',
};

export default function IntelligenceDemoPage() {
  return <IntelligenceDemo />;
}
