'use client';

import { createContext, useContext } from 'react';
import type { PublicTenantBranding } from '@/types/tenant';
import { DEFAULT_TENANT_SLUG, FALLBACK_BRANDING } from '@/services/tenant.service';

export interface BrandContextValue {
  branding: PublicTenantBranding;
  isLoading: boolean;
  tenantSlug: string;
  selectTenantSlug: (slug: string) => void;
  refreshBranding: () => Promise<void>;
}

export const BrandContext = createContext<BrandContextValue>({
  branding: FALLBACK_BRANDING,
  isLoading: true,
  tenantSlug: DEFAULT_TENANT_SLUG,
  selectTenantSlug: () => {},
  refreshBranding: async () => {},
});

export function useBrand() {
  return useContext(BrandContext);
}
