'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';
import { changeOwnPasswordAction } from './actions';

interface ChangePasswordFormProps {
  backHref?: string;
  onClose?: () => void;
  isModal?: boolean;
  branding?: {
    appName: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
  };
}

export function ChangePasswordForm({
  backHref = '/admin',
  onClose,
  isModal = false,
  branding,
}: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const primaryColor = branding?.primaryColor || 'var(--admin-primary, #C5161D)';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (newPassword.length < 6) {
      setFeedback({ type: 'error', message: 'A nova senha deve ter no mínimo 6 caracteres.' });
      return;
    }
    if (newPassword !== confirmation) {
      setFeedback({ type: 'error', message: 'A confirmação da nova senha não confere.' });
      return;
    }

    startTransition(async () => {
      const result = await changeOwnPasswordAction(currentPassword, newPassword, confirmation);
      if (!result.success) {
        setFeedback({ type: 'error', message: result.error });
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setFeedback({ type: 'success', message: result.message });
      if (isModal && onClose) {
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    });
  };

  const inputType = showPasswords ? 'text' : 'password';

  const formBody = (
    <form onSubmit={submit} className="relative w-full">
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-0 top-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      <div className="flex items-center gap-3">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-50 shadow-sm"
          style={{ color: primaryColor }}
        >
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.appName} className="h-8 w-8 object-contain" />
          ) : (
            <KeyRound className="h-6 w-6" />
          )}
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900">Alterar minha senha</h1>
          <p className="text-xs text-slate-500 font-medium">
            {branding?.appName ? `${branding.appName} • Segurança da conta` : 'Segurança da conta'}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Confirme sua senha atual e crie uma nova senha de acesso (mínimo de 6 caracteres).
      </p>

      {feedback && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-2xl border p-3.5 text-sm font-bold ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.type === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            Senha atual
          </label>
          <input
            type={inputType}
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Digite sua senha atual"
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            Nova senha (mínimo 6 caracteres)
          </label>
          <input
            type={inputType}
            minLength={6}
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Entre 6 e 8 dígitos (ou mais)"
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            Confirmar nova senha
          </label>
          <input
            type={inputType}
            minLength={6}
            required
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Repita a nova senha"
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowPasswords((current) => !current)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition"
      >
        {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {showPasswords ? 'Ocultar senhas digitadas' : 'Visualizar senhas'}
      </button>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
        <button
          disabled={isPending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-black text-white shadow-md transition disabled:opacity-50 hover:brightness-110 active:scale-95"
          style={{ backgroundColor: primaryColor }}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {isPending ? 'Salvando...' : 'Atualizar senha'}
        </button>

        {isModal && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={backHref}
            className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            Voltar ao painel
          </Link>
        )}
      </div>
    </form>
  );

  if (isModal) {
    return formBody;
  }

  return (
    <div className="mx-auto my-8 max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
      {formBody}
    </div>
  );
}
