import type { CSSProperties } from 'react';
import type {
  ConsumerCardBackgroundTransform,
  ConsumerCardElementPreferences,
  ConsumerCardLayout,
  ConsumerCardLayoutElement,
  ConsumerCardPosition,
} from '@/types/tenant';

export const DEFAULT_CONSUMER_CARD_BACKGROUND_TRANSFORM: ConsumerCardBackgroundTransform = {
  x: 50,
  y: 50,
  zoom: 100,
};

export const CONSUMER_CARD_LAYOUT_ELEMENTS: ConsumerCardLayoutElement[] = [
  'logo',
  'title',
  'qr',
  'photo',
  'name',
  'status',
  'balance',
];

export const DEFAULT_CONSUMER_CARD_LAYOUT: ConsumerCardLayout = {
  logo: { x: 22, y: 7 },
  title: { x: 76, y: 9 },
  qr: { x: 50, y: 35 },
  photo: { x: 20, y: 67 },
  name: { x: 61, y: 65 },
  status: { x: 61, y: 74 },
  balance: { x: 50, y: 84 },
};

export const DEFAULT_CONSUMER_CARD_ELEMENTS: ConsumerCardElementPreferences = {
  logo: { visible: true, zoom: 100 },
  title: { visible: true, zoom: 100 },
  qr: { visible: true, zoom: 100 },
  photo: { visible: true, zoom: 100 },
  name: { visible: true, zoom: 100 },
  status: { visible: true, zoom: 100 },
  balance: { visible: true, zoom: 100 },
};

const clamp = (value: number) => Math.min(94, Math.max(6, value));

export function normalizeConsumerCardLayout(value: unknown): ConsumerCardLayout {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return CONSUMER_CARD_LAYOUT_ELEMENTS.reduce((layout, element) => {
    const fallback = DEFAULT_CONSUMER_CARD_LAYOUT[element];
    const candidate = source[element];
    const position = candidate && typeof candidate === 'object'
      ? candidate as Partial<ConsumerCardPosition>
      : {};
    const x = Number(position.x);
    const y = Number(position.y);
    layout[element] = {
      x: clamp(Number.isFinite(x) ? x : fallback.x),
      y: clamp(Number.isFinite(y) ? y : fallback.y),
    };
    return layout;
  }, {} as ConsumerCardLayout);
}

export function getConsumerCardPositionStyle(position: ConsumerCardPosition): CSSProperties {
  return {
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: 'translate(-50%, -50%)',
  };
}

export function normalizeConsumerCardElements(value: unknown): ConsumerCardElementPreferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return CONSUMER_CARD_LAYOUT_ELEMENTS.reduce((preferences, element) => {
    const candidate = source[element] && typeof source[element] === 'object'
      ? source[element] as Partial<{ visible: boolean; zoom: number }>
      : {};
    const zoom = Number(candidate.zoom);
    preferences[element] = {
      visible: typeof candidate.visible === 'boolean' ? candidate.visible : true,
      zoom: Math.min(200, Math.max(50, Number.isFinite(zoom) ? zoom : 100)),
    };
    return preferences;
  }, {} as ConsumerCardElementPreferences);
}

export function getConsumerCardElementStyle(
  position: ConsumerCardPosition,
  zoom: number
): CSSProperties {
  return {
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: `translate(-50%, -50%) scale(${zoom / 100})`,
  };
}

export function normalizeConsumerCardBackgroundTransform(
  value: unknown
): ConsumerCardBackgroundTransform {
  const source = value && typeof value === 'object'
    ? value as Partial<ConsumerCardBackgroundTransform>
    : {};
  const x = Number(source.x);
  const y = Number(source.y);
  const zoom = Number(source.zoom);
  return {
    x: Math.min(100, Math.max(0, Number.isFinite(x) ? x : 50)),
    y: Math.min(100, Math.max(0, Number.isFinite(y) ? y : 50)),
    zoom: Math.min(200, Math.max(100, Number.isFinite(zoom) ? zoom : 100)),
  };
}

export function getConsumerCardBackgroundImageStyle(
  imageUrl: string,
  transform: ConsumerCardBackgroundTransform
): CSSProperties {
  const safeUrl = imageUrl.replace(/["'\\\r\n]/g, '');
  return {
    backgroundImage: `url("${safeUrl}")`,
    backgroundPosition: `${transform.x}% ${transform.y}%`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
    transform: `scale(${transform.zoom / 100})`,
    transformOrigin: `${transform.x}% ${transform.y}%`,
  };
}
