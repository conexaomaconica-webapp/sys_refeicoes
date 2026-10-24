'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { requestPasswordRecoveryAction } from './actions';

export function RecoveryRequestForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <form onSubmit={(event) => { event.preventDefault(); startTransition(async () => { await requestPasswordRecoveryAction(email); setSent(true); }); }} className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
        <h1 className="text-2xl font-black">Recuperar senha</h1>
        <p className="mt-2 text-sm text-slate-500">Informe o e-mail vinculado ao seu cadastro.</p>
        {sent ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.</div>
        ) : (
          <>
            <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-6 w-full rounded-xl border border-slate-300 px-3 py-3" />
            <button disabled={isPending} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#C5161D] px-4 py-3 font-black text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar recuperação</button>
          </>
        )}
        <div className="mt-5 flex justify-center gap-4 text-center text-sm font-bold text-slate-600">
          <Link href="/login" className="hover:underline">Login interno</Link>
          <Link href="/conta/login" className="hover:underline">Login do consumidor</Link>
        </div>
      </form>
    </main>
  );
}
