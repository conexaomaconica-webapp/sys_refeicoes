'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Image as ImageIcon, Loader2, Monitor, Palette, Save, UploadCloud } from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import {
  updateTenantTerminalPageBranding,
  uploadTenantTerminalPageBackground,
} from '@/services/tenant.service';
import type { UpdateTenantTerminalPageBrandingInput } from '@/types/tenant';

const DEFAULT_TERMINAL_PAGE_IMAGE = '/branding/terminal-ma-institutional.jpg';
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function TerminalPageBrandingSettings() {
  const { branding, refreshBranding } = useBrand();
  const [form, setForm] = useState<UpdateTenantTerminalPageBrandingInput>({
    terminal_page_background_mode: 'image',
    terminal_page_background_color: '#F8FAFC',
    terminal_page_background_url: DEFAULT_TERMINAL_PAGE_IMAGE,
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      terminal_page_background_mode: branding.terminal_page_background_mode,
      terminal_page_background_color: branding.terminal_page_background_color,
      terminal_page_background_url: branding.terminal_page_background_url,
    });
  }, [branding]);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : form.terminal_page_background_url),
    [file, form.terminal_page_background_url]
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
    if (!HEX_COLOR.test(form.terminal_page_background_color)) {
      setError('Informe a cor no formato hexadecimal #RRGGBB.');
      return;
    }

    setSaving(true);
    try {
      const backgroundUrl = file
        ? await uploadTenantTerminalPageBackground(file)
        : form.terminal_page_background_url;
      if (form.terminal_page_background_mode === 'image' && !backgroundUrl) {
        throw new Error('Escolha uma imagem para a página completa do terminal.');
      }
      const updated = { ...form, terminal_page_background_url: backgroundUrl };
      await updateTenantTerminalPageBranding(updated);
      setForm(updated);
      setFile(null);
      await refreshBranding();
      setMessage('Fundo completo do terminal salvo.');
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const previewStyle =
    form.terminal_page_background_mode === 'image' && previewUrl
      ? {
          backgroundColor: form.terminal_page_background_color,
          backgroundImage: `url("${previewUrl.replace(/["'\\\r\n]/g, '')}")`,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }
      : { backgroundColor: form.terminal_page_background_color };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black">
            <Monitor className="h-5 w-5 text-red-700" /> Fundo da página completa do terminal
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Independente do fundo da área operacional. Abrange carregamento, login e toda a página `/terminal`.
          </p>
        </div>
        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
          Somente Master
        </span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.9fr)]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {(['color', 'image'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm({ ...form, terminal_page_background_mode: mode })}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold ${
                  form.terminal_page_background_mode === mode
                    ? 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-100'
                    : 'border-slate-200'
                }`}
              >
                {mode === 'color' ? <Palette className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                {mode === 'color' ? 'Usar cor' : 'Usar imagem'}
              </button>
            ))}
          </div>

          <label className="block text-sm font-semibold">
            Cor base da página
            <div className="mt-1.5 flex gap-2">
              <input
                type="color"
                value={form.terminal_page_background_color}
                onChange={(event) => setForm({ ...form, terminal_page_background_color: event.target.value.toUpperCase() })}
                className="h-10 w-12 rounded-lg border border-slate-300 bg-white p-1"
              />
              <input
                value={form.terminal_page_background_color}
                maxLength={7}
                onChange={(event) => setForm({ ...form, terminal_page_background_color: event.target.value.toUpperCase() })}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 font-mono uppercase"
              />
            </div>
          </label>

          {form.terminal_page_background_mode === 'image' && (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 hover:border-red-300">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-red-700 shadow-sm"><UploadCloud className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">Enviar fundo da página completa</strong>
                  <small className="block text-slate-500">PNG, JPG ou WebP, até 5 MB. Recomendado: 1920 × 1080.</small>
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
                      setError('A imagem da página do terminal deve ter no máximo 5 MB.');
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
                    terminal_page_background_mode: 'image',
                    terminal_page_background_url: DEFAULT_TERMINAL_PAGE_IMAGE,
                  });
                }}
                className="text-xs font-bold text-red-700 underline"
              >
                Usar o modelo institucional enviado
              </button>
            </div>
          )}

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          {message && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{message}</p>}
          <button type="button" onClick={handleSave} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 font-black text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            {saving ? 'Salvando...' : 'Salvar fundo completo'}
          </button>
        </div>

        <div className="aspect-video overflow-hidden rounded-2xl border border-slate-200 p-4 shadow-inner" style={previewStyle}>
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/85 shadow-lg backdrop-blur-sm">
            <div className="h-8 border-b border-slate-200 bg-white/90" />
            <div className="grid flex-1 place-items-center p-4">
              <div className="w-2/3 rounded-xl border border-slate-200 bg-white/90 p-4 text-center shadow-md">
                <Monitor className="mx-auto h-6 w-6 text-red-700" />
                <strong className="mt-2 block text-xs">Área operacional</strong>
                <small className="text-[9px] text-slate-500">Mantém configuração própria</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
