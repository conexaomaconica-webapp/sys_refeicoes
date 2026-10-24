'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { completeConsumerActivationAction } from './actions';

export function ActivationForm({ fullName, isConsumer }: { fullName: string; isConsumer: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await completeConsumerActivationAction(formData);
      if (!result.success) return setError(result.error);
      router.replace(result.destination);
      router.refresh();
    });
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <form onSubmit={submit} className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-black">Concluir primeiro acesso</h1>
          <p className="mt-2 text-sm text-slate-500">Olá, {fullName}. Defina sua senha pessoal e complete seus dados.</p>
        </div>
        {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
        <div className="mt-6 space-y-4">
          <label className="block text-sm font-bold">Nova senha<input name="password" type="password" minLength={8} required autoComplete="new-password" className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
          <label className="block text-sm font-bold">Confirmar senha<input name="passwordConfirmation" type="password" minLength={8} required autoComplete="new-password" className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
          <label className="block text-sm font-bold">Telefone<input name="phone" type="tel" autoComplete="tel" className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
          {isConsumer && <label className="block text-sm font-bold">Foto opcional<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /></label>}
        </div>
        <button disabled={isPending} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#C5161D] px-4 py-3.5 font-black text-white disabled:opacity-50">
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />} Ativar minha conta
        </button>
      </form>
    </main>
  );
}
