import type { CSSProperties } from 'react';
import type { PublicTenantBranding, TerminalBackgroundPreset } from '@/types/tenant';

export const TERMINAL_BACKGROUND_PRESETS: Array<{
  id: TerminalBackgroundPreset;
  name: string;
  description: string;
  backgroundImage: string;
}> = [
  {
    id: 'institutional',
    name: 'Institucional',
    description: 'Vermelho e dourado suaves, alinhados à identidade MA.',
    backgroundImage:
      'radial-gradient(circle at 18% 18%, rgba(197, 22, 29, 0.18), transparent 32%), radial-gradient(circle at 82% 78%, rgba(244, 196, 48, 0.2), transparent 34%), linear-gradient(135deg, #fff7f7 0%, #ffffff 48%, #fffbea 100%)',
  },
  {
    id: 'warm',
    name: 'Acolhedor',
    description: 'Tons quentes e discretos para o horário das refeições.',
    backgroundImage:
      'radial-gradient(circle at 75% 20%, rgba(251, 146, 60, 0.2), transparent 34%), radial-gradient(circle at 20% 80%, rgba(250, 204, 21, 0.16), transparent 30%), linear-gradient(145deg, #fffaf2 0%, #fff7ed 52%, #ffffff 100%)',
  },
  {
    id: 'nature',
    name: 'Natural',
    description: 'Verdes suaves associados a alimentação e bem-estar.',
    backgroundImage:
      'radial-gradient(circle at 15% 25%, rgba(16, 185, 129, 0.17), transparent 34%), radial-gradient(circle at 85% 75%, rgba(132, 204, 22, 0.17), transparent 32%), linear-gradient(135deg, #f0fdf4 0%, #ffffff 50%, #f7fee7 100%)',
  },
  {
    id: 'geometric',
    name: 'Geométrico',
    description: 'Formas modernas com contraste visual leve.',
    backgroundImage:
      'linear-gradient(30deg, rgba(59, 130, 246, 0.08) 12%, transparent 12.5%, transparent 87%, rgba(59, 130, 246, 0.08) 87.5%), linear-gradient(150deg, rgba(139, 92, 246, 0.08) 12%, transparent 12.5%, transparent 87%, rgba(139, 92, 246, 0.08) 87.5%), linear-gradient(135deg, #f8fafc, #ffffff)',
  },
];

export function getTerminalBackgroundStyle(
  branding: Pick<
    PublicTenantBranding,
    'terminal_background_mode' | 'terminal_background_preset' | 'terminal_background_url'
  >,
  isDark = false
): CSSProperties {
  if (branding.terminal_background_mode === 'image' && branding.terminal_background_url) {
    const safeUrl = branding.terminal_background_url.replace(/["'\\\r\n]/g, '');
    const overlay = isDark ? 'rgba(2, 6, 23, 0.68)' : 'rgba(255, 255, 255, 0.68)';
    return {
      backgroundImage: `linear-gradient(${overlay}, ${overlay}), url("${safeUrl}")`,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    };
  }

  if (branding.terminal_background_mode === 'preset') {
    const preset = TERMINAL_BACKGROUND_PRESETS.find(
      (item) => item.id === branding.terminal_background_preset
    );
    if (preset) {
      return {
        backgroundImage: isDark
          ? `linear-gradient(rgba(2, 6, 23, 0.82), rgba(2, 6, 23, 0.82)), ${preset.backgroundImage}`
          : preset.backgroundImage,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
      };
    }
  }

  return {};
}
