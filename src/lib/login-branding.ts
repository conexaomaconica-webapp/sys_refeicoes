import type { LoginElementVisibility, LoginPanelPositions } from '@/types/tenant';

export const DEFAULT_LOGIN_ELEMENT_VISIBILITY: LoginElementVisibility = {
  logo: true,
  title: true,
  description: true,
  marketing: true,
  access_links: true,
  portal_switch: true,
  security_badge: true,
};

export const DEFAULT_LOGIN_PANEL_POSITIONS: LoginPanelPositions = {
  staff_desktop: { x: 78, y: 50 },
  staff_mobile: { x: 50, y: 50 },
  consumer_desktop: { x: 78, y: 50 },
  consumer_mobile: { x: 50, y: 66 },
};

export function normalizeLoginElementVisibility(value: unknown): LoginElementVisibility {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.keys(DEFAULT_LOGIN_ELEMENT_VISIBILITY).reduce((visibility, key) => {
    const element = key as keyof LoginElementVisibility;
    visibility[element] = typeof source[element] === 'boolean' ? source[element] as boolean : true;
    return visibility;
  }, {} as LoginElementVisibility);
}

export function normalizeLoginPanelPositions(value: unknown): LoginPanelPositions {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.keys(DEFAULT_LOGIN_PANEL_POSITIONS).reduce((positions, key) => {
    const target = key as keyof LoginPanelPositions;
    const fallback = DEFAULT_LOGIN_PANEL_POSITIONS[target];
    const candidate = source[target] && typeof source[target] === 'object'
      ? source[target] as Partial<{ x: number; y: number }>
      : {};
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    positions[target] = {
      x: Math.min(92, Math.max(8, Number.isFinite(x) ? x : fallback.x)),
      y: Math.min(92, Math.max(8, Number.isFinite(y) ? y : fallback.y)),
    };
    return positions;
  }, {} as LoginPanelPositions);
}
