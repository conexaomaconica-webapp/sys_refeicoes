'use client';

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import type { PublicTenantBranding } from '@/types/tenant';
import { BrandContext } from '@/components/branding/brand-context';
import {
  FALLBACK_BRANDING,
  DEFAULT_TENANT_SLUG,
  getPublicTenantBranding,
  normalizeTenantSlug,
} from '@/services/tenant.service';

export interface BrandProviderProps {
  children: React.ReactNode;
  initialSlug?: string;
}

export function BrandProvider({ children, initialSlug }: BrandProviderProps) {
  const [tenantSlug, setTenantSlug] = useState<string>(() => normalizeTenantSlug(initialSlug));
  const [branding, setBranding] = useState<PublicTenantBranding>(FALLBACK_BRANDING);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const querySlug = new URLSearchParams(window.location.search).get('tenant');
    const storedSlug = window.localStorage.getItem('ma-refeicoes-tenant-slug');
    const resolvedSlug = normalizeTenantSlug(querySlug || storedSlug || initialSlug);

    if (querySlug) window.localStorage.setItem('ma-refeicoes-tenant-slug', resolvedSlug);
    if (resolvedSlug !== tenantSlug) setTenantSlug(resolvedSlug);
  }, [initialSlug, tenantSlug]);

  const selectTenantSlug = useCallback((rawSlug: string) => {
    const resolvedSlug = normalizeTenantSlug(rawSlug);
    window.localStorage.setItem('ma-refeicoes-tenant-slug', resolvedSlug);
    setTenantSlug((currentSlug) => currentSlug === resolvedSlug ? currentSlug : resolvedSlug);
  }, []);

  const loadBranding = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getPublicTenantBranding(tenantSlug);
      if (
        data.tenant_id === FALLBACK_BRANDING.tenant_id &&
        tenantSlug !== DEFAULT_TENANT_SLUG
      ) {
        window.localStorage.removeItem('ma-refeicoes-tenant-slug');
        setTenantSlug(DEFAULT_TENANT_SLUG);
        return;
      }
      setBranding(data);
    } catch (err) {
      console.warn('[BrandProvider] Falha ao carregar branding:', err);
    } finally {
      setIsLoading(false);
    }
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
      root.style.setProperty('--terminal-primary', branding.terminal_primary_color);
      root.style.setProperty('--terminal-accent', branding.terminal_accent_color);
      root.style.setProperty('--terminal-surface', branding.terminal_surface_color);
    }
  }, [branding]);

  const value = useMemo(
    () => ({
      branding,
      isLoading,
      tenantSlug,
      selectTenantSlug,
      refreshBranding: loadBranding,
    }),
    [branding, isLoading, tenantSlug, selectTenantSlug, loadBranding]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
