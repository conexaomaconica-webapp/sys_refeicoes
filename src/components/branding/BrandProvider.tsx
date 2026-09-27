'use client';

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { PublicTenantBranding } from '@/types/tenant';
import {
  FALLBACK_BRANDING,
  DEFAULT_TENANT_SLUG,
  getPublicTenantBranding,
  normalizeTenantSlug,
} from '@/services/tenant.service';

interface BrandContextType {
  branding: PublicTenantBranding;
  isLoading: boolean;
  tenantSlug: string;
  refreshBranding: () => Promise<void>;
}

const BrandContext = createContext<BrandContextType>({
  branding: FALLBACK_BRANDING,
  isLoading: true,
  tenantSlug: DEFAULT_TENANT_SLUG,
  refreshBranding: async () => {},
});

export interface BrandProviderProps {
  children: React.ReactNode;
  initialSlug?: string;
}

export function BrandProvider({ children, initialSlug }: BrandProviderProps) {
  const [tenantSlug] = useState<string>(() => normalizeTenantSlug(initialSlug));
  const [branding, setBranding] = useState<PublicTenantBranding>(FALLBACK_BRANDING);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadBranding = useMemo(() => {
    return async () => {
      setIsLoading(true);
      try {
        const data = await getPublicTenantBranding(tenantSlug);
        setBranding(data);
      } catch (err) {
        console.warn('[BrandProvider] Falha ao carregar branding:', err);
      } finally {
        setIsLoading(false);
      }
    };
  }, [tenantSlug]);

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

  // Injeta variáveis CSS de branding no :root
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (branding.primary_color) {
        root.style.setProperty('--tenant-primary', branding.primary_color);
      }
      if (branding.secondary_color) {
        root.style.setProperty('--tenant-secondary', branding.secondary_color);
      }
      if (branding.splash_background) {
        root.style.setProperty('--tenant-splash-bg', branding.splash_background);
      }
    }
  }, [branding]);

  const value = useMemo(
    () => ({
      branding,
      isLoading,
      tenantSlug,
      refreshBranding: loadBranding,
    }),
    [branding, isLoading, tenantSlug, loadBranding]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand deve ser utilizado dentro de um BrandProvider');
  }
  return context;
}
