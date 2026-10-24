'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Eye, EyeOff, Image as ImageIcon, Loader2, Move, Palette, RotateCcw, Save, UploadCloud, User } from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import {
  updateTenantConsumerCardBranding,
  updateTenantConsumerCardBackgroundTransform,
  updateTenantConsumerCardElements,
  updateTenantConsumerCardLayout,
  uploadTenantConsumerCardBackground,
} from '@/services/tenant.service';
import {
  DEFAULT_CONSUMER_CARD_BACKGROUND_TRANSFORM,
  DEFAULT_CONSUMER_CARD_ELEMENTS,
  DEFAULT_CONSUMER_CARD_LAYOUT,
  getConsumerCardBackgroundImageStyle,
  getConsumerCardElementStyle,
} from '@/lib/consumer-card-layout';
import type {
  ConsumerCardBackgroundTransform,
  ConsumerCardElementPreferences,
  ConsumerCardLayout,
  ConsumerCardLayoutElement,
  UpdateTenantConsumerCardBrandingInput,
} from '@/types/tenant';

const DEFAULT_CARD_IMAGE = '/branding/consumer-card-ma.jpg';
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const POSITION_CONTROLS: Array<{ key: ConsumerCardLayoutElement; label: string }> = [
  { key: 'logo', label: 'Logomarca' },
  { key: 'title', label: 'Título' },
  { key: 'qr', label: 'QR Code' },
  { key: 'photo', label: 'Foto' },
  { key: 'name', label: 'Nome' },
  { key: 'status', label: 'Status' },
  { key: 'balance', label: 'Saldo' },
];

export function ConsumerCardBrandingSettings() {
  const { branding, refreshBranding } = useBrand();
  const [form, setForm] = useState<UpdateTenantConsumerCardBrandingInput>({
    consumer_card_background_mode: 'image',
    consumer_card_background_color: '#C5161D',
    consumer_card_accent_color: '#F4C430',
    consumer_card_background_url: DEFAULT_CARD_IMAGE,
  });
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<ConsumerCardLayout>(DEFAULT_CONSUMER_CARD_LAYOUT);
  const [elements, setElements] = useState<ConsumerCardElementPreferences>(
    DEFAULT_CONSUMER_CARD_ELEMENTS
  );
  const [backgroundTransform, setBackgroundTransform] = useState<ConsumerCardBackgroundTransform>(
    DEFAULT_CONSUMER_CARD_BACKGROUND_TRANSFORM
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      consumer_card_background_mode: branding.consumer_card_background_mode,
      consumer_card_background_color: branding.consumer_card_background_color,
      consumer_card_accent_color: branding.consumer_card_accent_color,
      consumer_card_background_url: branding.consumer_card_background_url,
    });
    setLayout(branding.consumer_card_layout);
    setElements(branding.consumer_card_elements);
    setBackgroundTransform(branding.consumer_card_background_transform);
  }, [branding]);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : form.consumer_card_background_url),
    [file, form.consumer_card_background_url]
  );

  useEffect(
    () => () => {
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const handleSave = async () => {
    setError(null);
    setMessage(null);
    if (
      !HEX_COLOR.test(form.consumer_card_background_color) ||
      !HEX_COLOR.test(form.consumer_card_accent_color)
    ) {
      setError('Informe as cores no formato hexadecimal #RRGGBB.');
      return;
    }

    setSaving(true);
    try {
      const backgroundUrl = file
        ? await uploadTenantConsumerCardBackground(file)
        : form.consumer_card_background_url;
      if (form.consumer_card_background_mode === 'image' && !backgroundUrl) {
        throw new Error('Escolha uma imagem para o fundo da carteirinha.');
      }
      const updated = { ...form, consumer_card_background_url: backgroundUrl };
      await updateTenantConsumerCardBranding(updated);
      await updateTenantConsumerCardLayout(layout);
      await updateTenantConsumerCardElements(elements);
      await updateTenantConsumerCardBackgroundTransform(backgroundTransform);
      setForm(updated);
      setFile(null);
      await refreshBranding();
      setMessage('AparÃªncia da carteirinha salva.');
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const backgroundImageStyle =
    form.consumer_card_background_mode === 'image' && previewUrl
      ? getConsumerCardBackgroundImageStyle(previewUrl, backgroundTransform)
      : null;

  const updatePosition = (
    element: ConsumerCardLayoutElement,
    axis: 'x' | 'y',
    value: number
  ) => {
    setLayout((current) => ({
      ...current,
      [element]: { ...current[element], [axis]: value },
    }));
  };

  const updateElement = (
    element: ConsumerCardLayoutElement,
    changes: Partial<ConsumerCardElementPreferences[ConsumerCardLayoutElement]>
  ) => {
    setElements((current) => ({
      ...current,
      [element]: { ...current[element], ...changes },
    }));
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black">
            <CreditCard className="h-5 w-5 text-red-700" /> Carteirinha virtual
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Escolha cor ou imagem. Nome, foto, QR, status e saldo continuam dinÃ¢micos.
          </p>
        </div>
        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
          Exclusivo Master
        </span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {(['color', 'image'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm({ ...form, consumer_card_background_mode: mode })}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold ${form.consumer_card_background_mode === mode
                    ? 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-100'
                    : 'border-slate-200'
                  }`}
              >
                {mode === 'color' ? <Palette className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                {mode === 'color' ? 'Usar cor' : 'Usar imagem'}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['consumer_card_background_color', 'Cor principal'],
              ['consumer_card_accent_color', 'Cor de destaque'],
            ] as const).map(([field, label]) => (
              <label key={field} className="text-sm font-semibold">
                {label}
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="color"
                    value={form[field]}
                    onChange={(event) => setForm({ ...form, [field]: event.target.value.toUpperCase() })}
                    className="h-10 w-12 rounded-lg border border-slate-300 bg-white p-1"
                  />
                  <input
                    value={form[field]}
                    maxLength={7}
                    onChange={(event) => setForm({ ...form, [field]: event.target.value.toUpperCase() })}
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 font-mono uppercase"
                  />
                </div>
              </label>
            ))}
          </div>

          {form.consumer_card_background_mode === 'image' && (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 hover:border-red-300">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-red-700 shadow-sm">
                  <UploadCloud className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">Enviar fundo da carteirinha</strong>
                  <small className="block text-slate-500">PNG, JPG ou WebP, atÃ© 5 MB.</small>
                  {file && <small className="block truncate font-bold text-emerald-700">{file.name}</small>}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] || null;
                    setError(null);
                    if (selected && selected.size > 5 * 1024 * 1024) {
                      setFile(null);
                      setError('A imagem da carteirinha deve ter no mÃ¡ximo 5 MB.');
                      return;
                    }
                    setFile(selected);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setForm({
                    ...form,
                    consumer_card_background_mode: 'image',
                    consumer_card_background_url: DEFAULT_CARD_IMAGE,
                  });
                }}
                className="text-xs font-bold text-red-700 underline"
              >
                Usar o modelo institucional MA
              </button>
              <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black text-slate-700">Enquadramento da imagem</span>
                  <button
                    type="button"
                    onClick={() => setBackgroundTransform(DEFAULT_CONSUMER_CARD_BACKGROUND_TRANSFORM)}
                    className="flex items-center gap-1 text-xs font-bold text-red-700"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Centralizar
                  </button>
                </div>
                {([
                  ['x', 'Horizontal', 0, 100, '%'],
                  ['y', 'Vertical', 0, 100, '%'],
                  ['zoom', 'Ampliação', 100, 200, '%'],
                ] as const).map(([field, label, min, max, suffix]) => (
                  <label key={field} className="mt-3 grid grid-cols-[72px_1fr_44px] items-center gap-2 text-xs font-bold text-slate-600">
                    <span>{label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={backgroundTransform[field]}
                      onChange={(event) => setBackgroundTransform((current) => ({
                        ...current,
                        [field]: Number(event.target.value),
                      }))}
                      className="w-full accent-red-700"
                    />
                    <output className="text-right font-mono text-slate-700">
                      {backgroundTransform[field]}{suffix}
                    </output>
                  </label>
                ))}
              </fieldset>
            </div>
          )}

          <section className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-black">
                  <Move className="h-4 w-4 text-red-700" /> Posição dos elementos
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Ajuste posição, visibilidade e zoom. A prévia é atualizada imediatamente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLayout(DEFAULT_CONSUMER_CARD_LAYOUT);
                  setElements(DEFAULT_CONSUMER_CARD_ELEMENTS);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restaurar posições
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {POSITION_CONTROLS.map(({ key, label }) => (
                <fieldset key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <legend className="px-1 text-xs font-black text-slate-700">
                    <button
                      type="button"
                      onClick={() => updateElement(key, { visible: !elements[key].visible })}
                      className="inline-flex items-center gap-1.5"
                      aria-pressed={elements[key].visible}
                    >
                      {elements[key].visible ? <Eye className="h-3.5 w-3.5 text-emerald-600" /> : <EyeOff className="h-3.5 w-3.5 text-slate-400" />}
                      {label}
                    </button>
                  </legend>
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis} className="mt-2 grid grid-cols-[18px_1fr_38px] items-center gap-2 text-[11px] font-bold text-slate-500">
                      <span>{axis.toUpperCase()}</span>
                      <input
                        type="range"
                        min={6}
                        max={94}
                        value={layout[key][axis]}
                        onChange={(event) => updatePosition(key, axis, Number(event.target.value))}
                        className="w-full accent-red-700"
                        aria-label={`${label}: posição ${axis === 'x' ? 'horizontal' : 'vertical'}`}
                      />
                      <output className="text-right font-mono text-slate-700">{layout[key][axis]}%</output>
                    </label>
                  ))}
                  <label className="mt-2 grid grid-cols-[36px_1fr_38px] items-center gap-2 text-[11px] font-bold text-slate-500">
                    <span>Zoom</span>
                    <input
                      type="range"
                      min={50}
                      max={200}
                      value={elements[key].zoom}
                      onChange={(event) => updateElement(key, { zoom: Number(event.target.value) })}
                      className="w-full accent-red-700"
                      aria-label={`${label}: zoom`}
                    />
                    <output className="text-right font-mono text-slate-700">{elements[key].zoom}%</output>
                  </label>
                </fieldset>
              ))}
            </div>
          </section>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          {message && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{message}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 font-black text-white disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            {saving ? 'Salvando...' : 'Salvar carteirinha'}
          </button>
        </div>

        <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem] text-white shadow-xl" style={{ backgroundColor: form.consumer_card_background_color }}>
          {backgroundImageStyle && (
            <div className="pointer-events-none absolute inset-0" style={backgroundImageStyle} />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/25" />
          {elements.logo.visible && <div className="absolute z-10 w-[38%] text-center" style={getConsumerCardElementStyle(layout.logo, elements.logo.zoom)}>
            {branding.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logo_url} alt="Prévia da logomarca" className="mx-auto max-h-12 max-w-full object-contain" />
            ) : (
              <strong className="text-sm font-black uppercase tracking-widest">{branding.app_name}</strong>
            )}
          </div>}
          {elements.title.visible && <p className="absolute z-10 w-[42%] text-center text-lg font-light uppercase leading-tight tracking-wider" style={getConsumerCardElementStyle(layout.title, elements.title.zoom)}>
            Cartão virtual<br /><strong>de consumo</strong>
          </p>}
          {elements.qr.visible && <div className="absolute z-10 grid h-32 w-32 place-items-center rounded-3xl bg-white/95 shadow-lg" style={getConsumerCardElementStyle(layout.qr, elements.qr.zoom)}>
            <span className="text-xs font-black text-slate-400">QR DINÂMICO</span>
          </div>}
          {elements.photo.visible && <span className="absolute z-10 grid h-16 w-16 place-items-center rounded-full border-4 bg-white text-slate-500 shadow-lg" style={{ ...getConsumerCardElementStyle(layout.photo, elements.photo.zoom), borderColor: form.consumer_card_accent_color }}>
            <User className="h-8 w-8" />
          </span>}
          {elements.name.visible && <div className="absolute z-10 w-[52%] text-center" style={getConsumerCardElementStyle(layout.name, elements.name.zoom)}>
            <strong className="block truncate text-sm">Nome do consumidor</strong>
            <small className="font-bold text-white/80">MATRÍCULA</small>
          </div>}
          {elements.status.visible && <span className="absolute z-10 rounded-full bg-emerald-500 px-2 py-1 text-[9px] font-black text-emerald-950" style={getConsumerCardElementStyle(layout.status, elements.status.zoom)}>
            ATIVO
          </span>}
          {elements.balance.visible && <div className="absolute z-10 w-[86%] rounded-2xl p-4 text-center font-black text-slate-950 shadow-lg" style={{ ...getConsumerCardElementStyle(layout.balance, elements.balance.zoom), backgroundColor: form.consumer_card_accent_color }}>
            SALDO DISPONÍVEL · R$ 00,00
          </div>}
          <footer className="absolute inset-x-5 bottom-3 z-10 flex justify-between font-mono text-[8px] font-bold text-white/70">
            <span>CARTEIRINHA DIGITAL</span><span>USO PESSOAL</span>
          </footer>
        </div>
      </div>
    </section>
  );
}
