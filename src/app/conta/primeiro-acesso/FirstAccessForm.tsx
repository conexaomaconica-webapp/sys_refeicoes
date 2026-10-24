'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import {
  listFirstAccessInstitutionsAction,
  requestFirstAccessAction,
} from './actions';

type Institution = { id: string; name: string; shortName: string | null };

export function FirstAccessForm() {
  const { branding, tenantSlug } = useBrand();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionId, setInstitutionId] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [cpf, setCpf] = useState('');
  const [fullName, setFullName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    listFirstAccessInstitutionsAction(tenantSlug).then((items) => {
      if (active) setInstitutions(items);
    });
    return () => { active = false; };
  }, [tenantSlug]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await requestFirstAccessAction({
        tenantSlug,
        institutionId,
        registrationNumber,
        cpf,
        fullName,
      });
      setMessage(result.message);
      setRegistrationNumber('');
      setCpf('');
      setFullName('');
    });
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <Link href="/conta/login" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Voltar ao login
        </Link>
        <div className="mt-6 text-center">
          <h1 className="text-2xl font-black">Primeiro acesso</h1>
          <p className="mt-2 text-sm text-slate-500">Confirme seus dados conforme a listagem oficial da instituição.</p>
        </div>

        {message && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            {message}
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-bold">
            Instituição de ensino
            <select required value={institutionId} onChange={(event) => setInstitutionId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-medium">
              <option value="">Selecione</option>
              {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.shortName || institution.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold">
            Matrícula
            <input required value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-mono font-medium" />
          </label>
          <label className="block text-sm font-bold">
            CPF completo
            <input required inputMode="numeric" autoComplete="off" maxLength={14} value={cpf} onChange={(event) => setCpf(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-medium" />
          </label>
          <label className="block text-sm font-bold">
            Nome completo
            <input required autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-medium" />
          </label>
          <button disabled={isPending || !institutions.length} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-black text-white disabled:opacity-50" style={{ backgroundColor: branding.primary_color || '#C5161D' }}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Solicitar primeiro acesso
          </button>
        </form>

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Os dados são comparados com a listagem oficial. O CPF não é armazenado em texto legível. Se não houver e-mail previamente cadastrado, a solicitação seguirá para análise administrativa.
        </p>
      </section>
    </main>
  );
}
