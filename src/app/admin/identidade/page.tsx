'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Eye, Image as ImageIcon, Loader2, Moon, Palette, Save, Sun, UploadCloud } from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import { LoginBrandingSettings } from '@/components/admin/LoginBrandingSettings';
import { ConsumerCardBrandingSettings } from '@/components/admin/ConsumerCardBrandingSettings';
import { TerminalPageBrandingSettings } from '@/components/admin/TerminalPageBrandingSettings';
import {
  updateTenantBrandingSettings,
  updateTenantTerminalBackground,
  updateTenantTerminalLayout,
  uploadTenantLogo,
  uploadTenantTerminalBackground,
} from '@/services/tenant.service';
import { getTerminalBackgroundStyle, TERMINAL_BACKGROUND_PRESETS } from '@/lib/terminal-background';
import type { UpdateTenantBrandingInput } from '@/types/tenant';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export default function AdminIdentidadePage() {
  const { branding, refreshBranding } = useBrand();
  const [form, setForm] = useState<UpdateTenantBrandingInput>({
    app_name: 'MA Refeições',
    logo_url: null,
    primary_color: '#C5161D',
    secondary_color: '#7F1D1D',
    terminal_theme: 'light',
    terminal_primary_color: '#C5161D',
    terminal_accent_color: '#F4C430',
    terminal_surface_color: '#F3F4F6',
    terminal_show_kpi_values: true,
    terminal_background_mode: 'none',
    terminal_background_preset: 'institutional',
    terminal_background_url: null,
    terminal_layout_variant: 'classic',
  });
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoPreview = useMemo(() => logoFile ? URL.createObjectURL(logoFile) : form.logo_url, [logoFile, form.logo_url]);
  const backgroundPreview = useMemo(
    () => backgroundFile ? URL.createObjectURL(backgroundFile) : form.terminal_background_url,
    [backgroundFile, form.terminal_background_url]
  );

  useEffect(() => {
    return () => {
      if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  useEffect(() => {
    return () => {
      if (backgroundPreview?.startsWith('blob:')) URL.revokeObjectURL(backgroundPreview);
    };
  }, [backgroundPreview]);

  useEffect(() => {
    setForm({
      app_name: branding.app_name,
      logo_url: branding.logo_url,
      primary_color: branding.primary_color || '#C5161D',
      secondary_color: branding.secondary_color || '#7F1D1D',
      terminal_theme: branding.terminal_theme,
      terminal_primary_color: branding.terminal_primary_color,
      terminal_accent_color: branding.terminal_accent_color,
      terminal_surface_color: branding.terminal_surface_color,
      terminal_show_kpi_values: branding.terminal_show_kpi_values,
      terminal_background_mode: branding.terminal_background_mode,
      terminal_background_preset: branding.terminal_background_preset,
      terminal_background_url: branding.terminal_background_url,
      terminal_layout_variant: branding.terminal_layout_variant,
    });
  }, [branding]);

  const setColor = (field: keyof UpdateTenantBrandingInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value.toUpperCase() }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const colors = [form.primary_color, form.secondary_color, form.terminal_primary_color, form.terminal_accent_color, form.terminal_surface_color];
    if (colors.some((color) => !HEX_COLOR.test(color))) {
      setError('Informe todas as cores no formato hexadecimal #RRGGBB.');
      return;
    }
    setSaving(true);
    try {
      const logoUrl = logoFile ? await uploadTenantLogo(logoFile) : form.logo_url;
      const backgroundUrl = backgroundFile
        ? await uploadTenantTerminalBackground(backgroundFile)
        : form.terminal_background_url;
      if (form.terminal_background_mode === 'image' && !backgroundUrl) {
        throw new Error('Envie uma foto antes de selecionar o fundo personalizado.');
      }
      const updatedForm = { ...form, logo_url: logoUrl, terminal_background_url: backgroundUrl };
      await updateTenantTerminalLayout(updatedForm.terminal_layout_variant);
      await updateTenantTerminalBackground({
        mode: updatedForm.terminal_background_mode,
        preset: updatedForm.terminal_background_preset,
        url: updatedForm.terminal_background_url,
      });
      await updateTenantBrandingSettings(updatedForm);
      setForm(updatedForm);
      setLogoFile(null);
      setBackgroundFile(null);
      await refreshBranding();
      setMessage('Identidade visual salva e aplicada ao terminal.');
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const isDark = form.terminal_theme === 'dark';
  const terminalBackgroundPreviewStyle = getTerminalBackgroundStyle(
    { ...form, terminal_background_url: backgroundPreview },
    isDark
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 p-5 md:p-9">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:text-slate-900">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-black">Configurações Master</h1>
              <p className="text-sm text-slate-500">Portais de login, logomarca, cores, terminal e identidade institucional.</p>
            </div>
          </div>
          <Palette className="h-8 w-8" style={{ color: form.terminal_primary_color }} />
        </header>

        <LoginBrandingSettings />
        <ConsumerCardBrandingSettings />
        <TerminalPageBrandingSettings />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.85fr)]">
          <form onSubmit={handleSave} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <section className="space-y-4">
              <div className="flex items-center gap-2 font-bold"><ImageIcon className="h-5 w-5" /> Marca oficial</div>
              <label className="block text-sm font-semibold">Nome exibido
                <input value={form.app_name} onChange={(e) => setForm({ ...form, app_name: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 outline-none focus:border-red-500" required />
              </label>
              <label className="group flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-red-300 hover:bg-red-50/40">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-red-700 shadow-sm"><UploadCloud className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-black">Enviar logomarca oficial</span>
                  <span className="mt-0.5 block text-xs text-slate-500">PNG, JPG ou WebP, até 2 MB. A proporção original será preservada.</span>
                  {logoFile && <span className="mt-1 block truncate text-xs font-bold text-emerald-700">Selecionado: {logoFile.name}</span>}
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setError(null);
                    if (file && file.size > 2 * 1024 * 1024) {
                      setLogoFile(null);
                      setError('A logomarca deve ter no máximo 2 MB.');
                      return;
                    }
                    setLogoFile(file);
                  }}
                />
              </label>
              <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <summary className="cursor-pointer font-bold text-slate-600">Usar uma URL externa</summary>
                <input value={logoFile ? '' : (form.logo_url || '')} disabled={Boolean(logoFile)} onChange={(e) => setForm({ ...form, logo_url: e.target.value || null })} placeholder="https://.../logo-ma-refeicoes.png" className="mt-3 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 outline-none focus:border-red-500 disabled:bg-slate-100" />
              </details>
            </section>

            <section className="space-y-4 border-t border-slate-100 pt-5">
              <div>
                <div className="font-bold">Layout do Terminal</div>
                <p className="mt-1 text-xs text-slate-500">Escolha a organização da tela operacional. A alteração não modifica regras de caixa ou consumo.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['classic', 'Clássico', 'Tela central ampla com controles compactos.'],
                  ['operational_dashboard', 'Painel Operacional', 'Últimos acessos e atalhos em painéis laterais.'],
                ] as const).map(([variant, name, description]) => (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => setForm({ ...form, terminal_layout_variant: variant })}
                    className={`rounded-2xl border p-4 text-left transition ${
                      form.terminal_layout_variant === variant
                        ? 'border-red-500 bg-red-50 text-red-800 ring-2 ring-red-100'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <strong className="block text-sm">{name}</strong>
                    <span className="mt-1 block text-xs opacity-70">{description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4 border-t border-slate-100 pt-5">
              <div className="font-bold">Tema padrão do Terminal</div>
              <div className="grid grid-cols-2 gap-3">
                {(['light', 'dark'] as const).map((theme) => (
                  <button key={theme} type="button" onClick={() => setForm({ ...form, terminal_theme: theme })} className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-bold ${form.terminal_theme === theme ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200'}`}>
                    {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    {theme === 'light' ? 'Claro (oficial)' : 'Escuro'}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  ['terminal_primary_color', 'Vermelho principal'],
                  ['terminal_accent_color', 'Amarelo de destaque'],
                  ['terminal_surface_color', 'Cinza dos cards'],
                  ['secondary_color', 'Cor secundária'],
                ] as const).map(([field, label]) => (
                  <label key={field} className="text-sm font-semibold">{label}
                    <div className="mt-1.5 flex gap-2">
                      <input type="color" value={form[field]} onChange={(e) => setColor(field, e.target.value)} className="h-10 w-12 rounded-lg border border-slate-300 bg-white p-1" />
                      <input value={form[field]} onChange={(e) => setColor(field, e.target.value)} maxLength={7} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 font-mono uppercase" />
                    </div>
                  </label>
                ))}
              </div>
              <label className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold">
                Mostrar valores financeiros nos KPIs
                <input type="checkbox" checked={form.terminal_show_kpi_values} onChange={(e) => setForm({ ...form, terminal_show_kpi_values: e.target.checked })} className="h-5 w-5 accent-red-600" />
              </label>
            </section>

            <section className="space-y-4 border-t border-slate-100 pt-5">
              <div>
                <div className="flex items-center gap-2 font-bold"><ImageIcon className="h-5 w-5" /> Fundo da área central</div>
                <p className="mt-1 text-xs text-slate-500">Opcional. Afeta somente o centro da tela do terminal; cabeçalho, indicadores e caixa permanecem legíveis.</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {([
                  ['none', 'Sem fundo'],
                  ['preset', 'Tema pronto'],
                  ['image', 'Minha foto'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm({ ...form, terminal_background_mode: mode })}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                      form.terminal_background_mode === mode
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {form.terminal_background_mode === 'preset' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {TERMINAL_BACKGROUND_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setForm({ ...form, terminal_background_preset: preset.id })}
                      className={`overflow-hidden rounded-2xl border text-left transition ${
                        form.terminal_background_preset === preset.id
                          ? 'border-red-500 ring-2 ring-red-100'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className="block h-20" style={{ backgroundImage: preset.backgroundImage, backgroundSize: 'cover' }} />
                      <span className="block p-3">
                        <strong className="block text-sm">{preset.name}</strong>
                        <span className="mt-0.5 block text-xs text-slate-500">{preset.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {form.terminal_background_mode === 'image' && (
                <div className="space-y-3">
                  <label className="group flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-red-300 hover:bg-red-50/40">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-red-700 shadow-sm"><UploadCloud className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-black">Enviar foto para o terminal</span>
                      <span className="mt-0.5 block text-xs text-slate-500">PNG, JPG ou WebP, até 5 MB. Recomendado: imagem horizontal em 1920 × 1080.</span>
                      {backgroundFile && <span className="mt-1 block truncate text-xs font-bold text-emerald-700">Selecionada: {backgroundFile.name}</span>}
                    </div>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setError(null);
                        if (file && file.size > 5 * 1024 * 1024) {
                          setBackgroundFile(null);
                          setError('A imagem de fundo deve ter no máximo 5 MB.');
                          return;
                        }
                        setBackgroundFile(file);
                      }}
                    />
                  </label>
                  {(backgroundPreview || backgroundFile) && (
                    <button
                      type="button"
                      onClick={() => {
                        setBackgroundFile(null);
                        setForm({ ...form, terminal_background_url: null });
                      }}
                      className="text-xs font-bold text-red-700 underline"
                    >
                      Remover imagem selecionada
                    </button>
                  )}
                </div>
              )}
            </section>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
            {message && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{message}</div>}
            <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-black text-white disabled:opacity-60" style={{ backgroundColor: form.terminal_primary_color }}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              {saving ? 'Salvando...' : 'Salvar identidade'}
            </button>
          </form>

          <aside className={`overflow-hidden rounded-3xl border shadow-xl ${isDark ? 'border-slate-700 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
            <div className="flex items-center justify-between border-b border-current/10 p-5">
              <div className="flex items-center gap-3">
                {logoPreview ? <img /* eslint-disable-line @next/next/no-img-element */ src={logoPreview} alt="Prévia da logomarca" className="h-12 w-20 object-contain" /> : <div className="grid h-12 w-16 place-items-center rounded-lg font-black text-white" style={{ backgroundColor: form.terminal_primary_color }}>MA</div>}
                <div><strong>{form.app_name}</strong><p className="text-xs opacity-60">RU Central • Almoço • Caixa 01</p></div>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Online</span>
            </div>
            <div className="min-h-[360px] p-5 text-center" style={terminalBackgroundPreviewStyle}>
              {form.terminal_layout_variant === 'operational_dashboard' ? (
                <div className="grid min-h-[320px] grid-cols-[0.7fr_1.6fr_0.75fr] gap-3">
                  <div className="overflow-hidden rounded-2xl border border-current/15 text-left" style={{ backgroundColor: isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.94)' }}>
                    <p className="border-b border-current/10 p-3 text-[10px] font-black uppercase">Últimos acessos</p>
                    {['Carlos Silva', 'Mariana Oliveira', 'Pedro Henrique'].map((name, index) => (
                      <div key={name} className="flex items-center gap-2 border-b border-current/10 p-3 last:border-b-0">
                        <span className={`grid h-7 w-7 place-items-center rounded-full text-[9px] font-black text-white ${index === 1 ? 'bg-red-600' : 'bg-emerald-600'}`}>{name.split(' ').map((part) => part[0]).join('')}</span>
                        <span className="min-w-0"><strong className="block truncate text-[10px]">{name}</strong><small className={index === 1 ? 'text-red-500' : 'text-emerald-500'}>{index === 1 ? 'Bloqueado' : 'Liberado'}</small></span>
                      </div>
                    ))}
                  </div>
                  <div className="grid place-items-center rounded-3xl border-2 p-5 backdrop-blur-sm" style={{ backgroundColor: isDark ? 'rgba(17, 24, 39, 0.90)' : 'rgba(255, 255, 255, 0.92)', borderColor: form.terminal_primary_color }}>
                    <div className="w-full">
                      <Eye className="mx-auto mb-3 h-7 w-7" style={{ color: form.terminal_primary_color }} />
                      <h2 className="text-lg font-black uppercase">Aguardando identificação</h2>
                      <p className="mt-1 text-[10px] opacity-60">Aproxime o cartão ou digite a matrícula</p>
                      <div className="mt-4 rounded-xl border-2 bg-transparent p-3 text-xs opacity-60" style={{ borderColor: form.terminal_accent_color }}>Matrícula ou código</div>
                      <div className="mt-3 rounded-xl p-3 text-xs font-black text-white" style={{ backgroundColor: form.terminal_primary_color }}>LIBERAR REFEIÇÃO</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-current/15 p-3 text-left" style={{ backgroundColor: isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.94)' }}>
                    <p className="text-[10px] font-black uppercase">Atalhos</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {['Categorias', 'Caixas', 'Rede', 'Identidade'].map((label) => <span key={label} className="grid min-h-14 place-items-center rounded-lg border border-current/10 text-center text-[9px] font-bold">{label}</span>)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-[320px] place-items-center">
                  <div className="w-full rounded-3xl border border-current/10 p-8 backdrop-blur-sm" style={{ backgroundColor: isDark ? 'rgba(17, 24, 39, 0.86)' : 'rgba(255, 255, 255, 0.86)' }}>
                    <Eye className="mx-auto mb-4 h-7 w-7" style={{ color: form.terminal_primary_color }} />
                    <h2 className="text-2xl font-black">Aguardando identificação</h2>
                    <p className="mt-1 text-sm opacity-60">Aproxime o cartão ou digite a matrícula</p>
                    <div className="mt-5 rounded-xl border border-current/20 bg-transparent p-3 text-sm opacity-60">Matrícula ou código</div>
                    <div className="mt-3 rounded-xl p-3 font-black text-white" style={{ backgroundColor: form.terminal_primary_color }}>LIBERAR REFEIÇÃO</div>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-current/10 p-5">
              <div className="rounded-xl p-3" style={{ backgroundColor: isDark ? '#111827' : form.terminal_surface_color }}><span className="text-xs opacity-60">Refeições liberadas</span><p className="text-xl font-black">128</p></div>
              <div className="rounded-xl p-3" style={{ backgroundColor: form.terminal_accent_color, color: '#3F2F00' }}><span className="text-xs">Total recebido</span><p className="text-xl font-black">{form.terminal_show_kpi_values ? 'R$ 805,00' : '••••••'}</p></div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
