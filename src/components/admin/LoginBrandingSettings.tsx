'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Save,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  X,
} from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import {
  updateTenantLoginBranding,
  updateTenantLoginElementVisibility,
  updateTenantLoginPanelPositions,
  uploadTenantLoginBackground,
  type LoginBackgroundTarget,
} from '@/services/tenant.service';
import type { UpdateTenantLoginBrandingInput } from '@/types/tenant';
import type {
  LoginBrandingElement,
  LoginElementVisibility,
  LoginPanelPositions,
  LoginPanelPositionTarget,
} from '@/types/tenant';

const ELEMENT_CONFIG: Array<{ key: LoginBrandingElement; label: string }> = [
  { key: 'logo', label: 'Logomarca' },
  { key: 'title', label: 'Título' },
  { key: 'description', label: 'Descrição' },
  { key: 'marketing', label: 'Chamada lateral' },
  { key: 'access_links', label: 'Links de acesso' },
  { key: 'portal_switch', label: 'Troca de portal' },
  { key: 'security_badge', label: 'Selo de segurança' },
];

type LoginImageKey = keyof UpdateTenantLoginBrandingInput;

const EMPTY_VALUES: UpdateTenantLoginBrandingInput = {
  staff_login_background_url: null,
  staff_login_mobile_background_url: null,
  consumer_login_background_url: null,
  consumer_login_mobile_background_url: null,
};

const FIELD_CONFIG: Array<{
  key: LoginImageKey;
  target: LoginBackgroundTarget;
  title: string;
  recommendation: string;
  mobile: boolean;
  positionTarget: LoginPanelPositionTarget;
}> = [
  {
    key: 'staff_login_background_url',
    target: 'staff-desktop',
    title: 'Portal interno — desktop',
    recommendation: 'Horizontal, recomendado 1920 × 1080',
    mobile: false,
    positionTarget: 'staff_desktop',
  },
  {
    key: 'staff_login_mobile_background_url',
    target: 'staff-mobile',
    title: 'Portal interno — mobile',
    recommendation: 'Vertical, recomendado 1080 × 1920',
    mobile: true,
    positionTarget: 'staff_mobile',
  },
  {
    key: 'consumer_login_background_url',
    target: 'consumer-desktop',
    title: 'Portal do consumidor — desktop',
    recommendation: 'Horizontal, recomendado 1920 × 1080',
    mobile: false,
    positionTarget: 'consumer_desktop',
  },
  {
    key: 'consumer_login_mobile_background_url',
    target: 'consumer-mobile',
    title: 'Portal do consumidor — mobile',
    recommendation: 'Vertical, recomendado 1080 × 1920',
    mobile: true,
    positionTarget: 'consumer_mobile',
  },
];

export function LoginBrandingSettings() {
  const { branding, refreshBranding } = useBrand();
  const [values, setValues] = useState<UpdateTenantLoginBrandingInput>(EMPTY_VALUES);
  const [files, setFiles] = useState<Partial<Record<LoginImageKey, File>>>({});
  const [visibility, setVisibility] = useState<LoginElementVisibility>(
    branding.login_element_visibility
  );
  const [panelPositions, setPanelPositions] = useState<LoginPanelPositions>(
    branding.login_panel_positions
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({
      staff_login_background_url: branding.staff_login_background_url,
      staff_login_mobile_background_url: branding.staff_login_mobile_background_url,
      consumer_login_background_url: branding.consumer_login_background_url,
      consumer_login_mobile_background_url: branding.consumer_login_mobile_background_url,
    });
    setVisibility(branding.login_element_visibility);
    setPanelPositions(branding.login_panel_positions);
  }, [branding]);

  const previews = useMemo(() => {
    const result = {} as Record<LoginImageKey, string | null>;
    FIELD_CONFIG.forEach(({ key }) => {
      result[key] = files[key] ? URL.createObjectURL(files[key] as File) : values[key];
    });
    return result;
  }, [files, values]);

  useEffect(
    () => () => {
      Object.values(previews).forEach((url) => {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    },
    [previews]
  );

  const selectFile = (key: LoginImageKey, file: File | null) => {
    setError(null);
    setMessage(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Formato não permitido. Use PNG, JPG ou WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Cada imagem deve ter no máximo 5 MB.');
      return;
    }
    setFiles((current) => ({ ...current, [key]: file }));
  };

  const removeImage = (key: LoginImageKey) => {
    setFiles((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setValues((current) => ({ ...current, [key]: null }));
    setMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const uploaded = await Promise.all(
        FIELD_CONFIG.filter(({ key }) => Boolean(files[key])).map(async ({ key, target }) => [
          key,
          await uploadTenantLoginBackground(files[key] as File, target),
        ] as const)
      );
      const nextValues = { ...values };
      uploaded.forEach(([key, url]) => {
        nextValues[key] = url;
      });
      await updateTenantLoginBranding(nextValues);
      await updateTenantLoginElementVisibility(visibility);
      await updateTenantLoginPanelPositions(panelPositions);
      setValues(nextValues);
      setFiles({});
      await refreshBranding();
      setMessage('Fundos dos portais atualizados com sucesso.');
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-amber-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-black">Portais de acesso</h2>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
              Exclusivo Master
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Configure fundos independentes para administradores/operadores e consumidores.
            A versão mobile é usada abaixo de 768 px; quando estiver vazia, o sistema reutiliza
            automaticamente a imagem desktop.
          </p>
        </div>
        <ImageIcon className="h-8 w-8 text-slate-300" />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-black text-slate-900">Elementos visíveis nos logins</h3>
        <p className="mt-1 text-xs text-slate-500">
          A configuração vale para o portal interno e o portal do consumidor. O formulário de acesso permanece sempre visível.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ELEMENT_CONFIG.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setVisibility((current) => ({ ...current, [key]: !current[key] }))}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-black transition ${visibility[key] ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}
              aria-pressed={visibility[key]}
            >
              {visibility[key] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {FIELD_CONFIG.map(({ key, title, recommendation, mobile, positionTarget }) => {
          const preview = previews[key];
          const selectedFile = files[key];
          const DeviceIcon = mobile ? Smartphone : Monitor;
          return (
            <article key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <div
                className={`relative grid place-items-center overflow-hidden bg-slate-200 ${mobile ? 'mx-auto aspect-[9/16] max-h-64 w-36' : 'aspect-video w-full'}`}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt={`Prévia: ${title}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center text-slate-400">
                    <DeviceIcon className="mx-auto h-7 w-7" />
                    <span className="mt-2 block text-xs font-bold">Sem imagem</span>
                  </div>
                )}
                <div
                  className="pointer-events-none absolute grid h-12 w-20 place-items-center rounded-lg border border-white/80 bg-white/90 text-[8px] font-black text-slate-700 shadow-lg"
                  style={{
                    left: `${panelPositions[positionTarget].x}%`,
                    top: `${panelPositions[positionTarget].y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  CAIXA DE LOGIN
                </div>
                {preview && (
                  <button
                    type="button"
                    onClick={() => removeImage(key)}
                    className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-red-700 shadow"
                    title="Remover imagem"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="space-y-3 p-4">
                <div>
                  <h3 className="text-sm font-black text-slate-900">{title}</h3>
                  <p className="mt-1 text-xs text-slate-500">{recommendation}</p>
                </div>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700 hover:border-red-300 hover:text-red-700">
                  <UploadCloud className="h-4 w-4" />
                  {selectedFile ? 'Trocar arquivo' : preview ? 'Substituir imagem' : 'Enviar imagem'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(event) => selectFile(key, event.target.files?.[0] || null)}
                  />
                </label>
                {selectedFile && (
                  <p className="truncate text-[11px] font-bold text-emerald-700">
                    Selecionada: {selectedFile.name}
                  </p>
                )}
                <fieldset className="rounded-xl border border-slate-200 bg-white p-3">
                  <legend className="px-1 text-[11px] font-black text-slate-700">Posição da caixa</legend>
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis} className="mt-2 grid grid-cols-[18px_1fr_36px] items-center gap-2 text-[10px] font-bold text-slate-500">
                      <span>{axis.toUpperCase()}</span>
                      <input
                        type="range"
                        min={8}
                        max={92}
                        value={panelPositions[positionTarget][axis]}
                        onChange={(event) => setPanelPositions((current) => ({
                          ...current,
                          [positionTarget]: {
                            ...current[positionTarget],
                            [axis]: Number(event.target.value),
                          },
                        }))}
                        className="w-full accent-amber-500"
                        aria-label={`${title}: posição ${axis === 'x' ? 'horizontal' : 'vertical'} da caixa de login`}
                      />
                      <output className="text-right font-mono text-slate-700">
                        {panelPositions[positionTarget][axis]}%
                      </output>
                    </label>
                  ))}
                </fieldset>
              </div>
            </article>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3.5 font-black text-slate-950 transition hover:bg-amber-400 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
        {saving ? 'Salvando fundos...' : 'Salvar telas de login'}
      </button>
    </section>
  );
}
