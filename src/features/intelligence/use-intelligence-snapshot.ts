'use client';

import { useEffect, useState } from 'react';
import type { IntelligenceDataProvider, IntelligenceFilters, IntelligenceProviderResult } from './contracts';
import { SYNTHETIC_DEMO_ACCESS } from './contracts';
import { syntheticIntelligenceProvider } from './providers/synthetic-intelligence.provider';

export function useIntelligenceSnapshot(
  filters: IntelligenceFilters,
  provider: IntelligenceDataProvider = syntheticIntelligenceProvider
) {
  const [result, setResult] = useState<IntelligenceProviderResult | null>(null);

  useEffect(() => {
    let active = true;
    setResult(null);
    provider.getSnapshot({ filters, access: SYNTHETIC_DEMO_ACCESS })
      .then((nextResult) => {
        if (active) setResult(nextResult);
      })
      .catch(() => {
        if (active) setResult({ status: 'unavailable', reason: 'Falha inesperada no fornecedor de indicadores.', retryable: true });
      });
    return () => { active = false; };
  }, [filters, provider]);

  return result;
}
