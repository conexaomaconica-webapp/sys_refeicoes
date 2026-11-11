'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Phone,
  ShieldCheck,
  Utensils,
} from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { completeConsumerActivationAction } from './actions';

interface ActivationFormProps {
  fullName: string;
  isConsumer: boolean;
  branding?: {
    appName: string;
    logoUrl: string | null;
    slug: string;
    primaryColor: string;
    secondaryColor: string;
  };
}

export function ActivationForm({ fullName, isConsumer, branding }: ActivationFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const primaryColor = branding?.primaryColor || '#C5161D';
  const appName = branding?.appName || 'MA Refeições';

  const passwordsMatch = password.length > 0 && password === passwordConfirmation;
  const passwordsMismatch = passwordConfirmation.length > 0 && password !== passwordConfirmation;

  const handleSignOut = async () => {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.replace(isConsumer ? '/conta/login' : '/login');
    router.refresh();
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (password !== passwordConfirmation) {
      setError('A confirmação da senha não confere.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await completeConsumerActivationAction(formData);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.replace(result.destination);
      router.refresh();
    });
  };

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{
        background: `radial-gradient(circle at 50% 10%, ${primaryColor}18, transparent 32rem), #f8fafc`,
      }}
    >
      <div className="w-full max-w-lg">
        {/* Card Principal */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xl sm:p-8">
          {/* Identidade Visual / Cabeçalho */}
          <div className="flex flex-col items-center text-center">
            {branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={appName}
                className="h-14 max-w-[200px] object-contain drop-shadow-sm"
              />
            ) : (
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md"
                style={{ backgroundColor: primaryColor }}
              >
                <Utensils className="h-7 w-7" />
              </div>
            )}

            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              {appName} • {isConsumer ? 'Portal do Aluno / Consumidor' : 'Acesso Operacional'}
            </div>

            <h1 className="mt-4 text-2xl font-black text-slate-900 tracking-tight">
              Concluir primeiro acesso
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Olá, <strong className="font-bold text-slate-800">{fullName}</strong>! Defina sua
              senha pessoal para ativar sua conta.
            </p>
          </div>

          {/* Alerta de Erro */}
          {error && (
            <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-800 animate-in fade-in">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            {/* Campo Nova Senha */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Nova senha (mínimo 6 caracteres)
              </label>
              <div className="relative mt-1.5">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite sua nova senha"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Campo Confirmar Senha */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Confirmar senha
                </label>
                {passwordsMatch && (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> Senhas conferem
                  </span>
                )}
                {passwordsMismatch && (
                  <span className="text-[11px] font-bold text-red-600">
                    As senhas não conferem
                  </span>
                )}
              </div>
              <div className="relative mt-1.5">
                <input
                  name="passwordConfirmation"
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  minLength={6}
                  required
                  autoComplete="new-password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  placeholder="Repita a nova senha"
                  className={`w-full rounded-xl border px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition ${
                    passwordsMismatch
                      ? 'border-red-400 focus:border-red-600 focus:ring-2 focus:ring-red-100'
                      : passwordsMatch
                      ? 'border-emerald-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'
                      : 'border-slate-300 focus:border-red-600 focus:ring-2 focus:ring-red-100'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirmation((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                  aria-label={showPasswordConfirmation ? 'Ocultar confirmação' : 'Exibir confirmação'}
                  tabIndex={-1}
                >
                  {showPasswordConfirmation ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Campo Telefone */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Telefone / WhatsApp (opcional)
              </label>
              <div className="relative mt-1.5">
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(DDD) 99999-9999"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />
                <Phone className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
            </div>

            {/* Foto Opcional para Consumidor */}
            {isConsumer && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Foto de identificação (opcional)
                </label>
                <div className="mt-1.5 flex items-center gap-3">
                  <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-100 transition">
                    <Camera className="h-4 w-4 text-slate-500" />
                    <span>{selectedFileName || 'Selecionar foto (JPEG, PNG ou WebP)'}</span>
                    <input
                      name="photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setSelectedFileName(file ? file.name : null);
                      }}
                    />
                  </label>
                  {selectedFileName && (
                    <button
                      type="button"
                      onClick={() => setSelectedFileName(null)}
                      className="rounded-xl border border-slate-200 px-2.5 py-3 text-xs font-bold text-slate-500 hover:text-red-600 transition"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  A foto é exibida na sua carteirinha digital no restaurante (máx. 5 MB).
                </p>
              </div>
            )}

            {/* Botão de Envio */}
            <button
              type="submit"
              disabled={isPending || passwordsMismatch}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-black text-white shadow-lg transition disabled:opacity-50 hover:brightness-110 active:scale-[0.99]"
              style={{ backgroundColor: primaryColor }}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Ativando conta...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Ativar minha conta
                </>
              )}
            </button>
          </form>

          {/* Rodapé com opção de sair */}
          <div className="mt-6 border-t border-slate-100 pt-4 text-center">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
            >
              <LogOut className="h-3.5 w-3.5" /> Entrar com outra conta
            </button>
          </div>
        </div>

        {/* Rodapé Institucional */}
        <p className="mt-4 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} {appName}. Todos os direitos reservados.
        </p>
      </div>
    </main>
  );
}
