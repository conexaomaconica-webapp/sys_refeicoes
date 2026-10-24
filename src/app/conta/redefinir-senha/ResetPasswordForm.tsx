'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { redefinePasswordAction } from './actions';

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <form onSubmit={(event) => { event.preventDefault(); setError(null); startTransition(async () => { const result = await redefinePasswordAction(password, confirmation); if (!result.success) return setError(result.error); router.replace(result.redirectTo); router.refresh(); }); }} className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
        <h1 className="text-2xl font-black">Definir nova senha</h1>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
        <label className="mt-6 block text-sm font-bold">Nova senha<input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
        <label className="mt-4 block text-sm font-bold">Confirmar senha<input type="password" minLength={8} required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
        <button disabled={isPending} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#C5161D] px-4 py-3 font-black text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar nova senha</button>
      </form>
    </main>
  );
}
