'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Clock3, Edit3, MapPin, Plus, Search, Store, X } from 'lucide-react';
import type {
  ManagedUnit,
  SaveUnitInput,
  UnitInstitutionOption,
} from '@/services/admin-unit.service';
import { saveUnitAction } from './actions';

interface Props {
  units: ManagedUnit[];
  institutions: UnitInstitutionOption[];
  canCreate: boolean;
  canManageLifecycle: boolean;
}

const timezones = [
  'America/Bahia',
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Rio_Branco',
];

const emptyForm = (institutions: UnitInstitutionOption[]): SaveUnitInput => ({
  institutionId: institutions.find((item) => item.status === 'active')?.id || '',
  name: '',
  city: '',
  state: '',
  timezone: 'America/Bahia',
  status: 'active',
});

export function UnitManager({ units, institutions, canCreate, canManageLifecycle }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUnit | null>(null);
  const [form, setForm] = useState<SaveUnitInput>(() => emptyForm(institutions));
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const filteredUnits = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return units.filter((unit) => {
      const matchesSearch = !term ||
        unit.name.toLocaleLowerCase('pt-BR').includes(term) ||
        unit.city.toLocaleLowerCase('pt-BR').includes(term) ||
        unit.institutionName.toLocaleLowerCase('pt-BR').includes(term);
      return matchesSearch &&
        (institutionFilter === 'all' || unit.institutionId === institutionFilter) &&
        (statusFilter === 'all' || unit.status === statusFilter);
    });
  }, [institutionFilter, search, statusFilter, units]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(institutions));
    setMessage(null);
    setModalOpen(true);
  };

  const openEdit = (unit: ManagedUnit) => {
    setEditing(unit);
    setForm({
      id: unit.id,
      institutionId: unit.institutionId,
      name: unit.name,
      city: unit.city,
      state: unit.state,
      timezone: unit.timezone,
      status: unit.status,
    });
    setMessage(null);
    setModalOpen(true);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveUnitAction(form);
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      setModalOpen(false);
      setMessage({ kind: 'success', text: result.message });
      router.refresh();
    });
  };

  const activeCount = units.filter((unit) => unit.status === 'active').length;
  const dailyCount = units.filter((unit) => unit.cashShiftMode === 'daily').length;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <section className="flex flex-col justify-between gap-5 rounded-3xl p-6 text-white shadow-xl md:flex-row md:items-end md:p-8" style={{ background: 'linear-gradient(135deg, var(--admin-secondary), var(--admin-primary))' }}>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Estrutura operacional</p>
          <h1 className="mt-2 text-3xl font-black">Unidades</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80">Consulte e configure os restaurantes vinculados às instituições do tenant.</p>
        </div>
        {canCreate && <button type="button" onClick={openCreate} disabled={!institutions.some((item) => item.status === 'active')} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black shadow-lg disabled:opacity-50" style={{ color: 'var(--admin-primary)' }}><Plus className="h-5 w-5" /> Nova unidade</button>}
      </section>

      {message && <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${message.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Building2 className="h-5 w-5" style={{ color: 'var(--admin-primary)' }} /><p className="mt-2 text-2xl font-black">{units.length}</p><p className="text-xs font-bold uppercase text-slate-500">Unidades visíveis</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Store className="h-5 w-5 text-emerald-600" /><p className="mt-2 text-2xl font-black">{activeCount}</p><p className="text-xs font-bold uppercase text-slate-500">Ativas</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Clock3 className="h-5 w-5 text-amber-600" /><p className="mt-2 text-2xl font-black">{dailyCount}</p><p className="text-xs font-bold uppercase text-slate-500">Caixa diário</p></div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.4fr)_minmax(190px,0.8fr)_minmax(150px,0.5fr)]">
          <label className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar unidade, cidade ou instituição" className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-3 text-sm outline-none" /></label>
          <select value={institutionFilter} onChange={(event) => setInstitutionFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-3 text-sm"><option value="all">Todas as instituições</option>{institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-3 text-sm"><option value="all">Todos os status</option><option value="active">Ativas</option><option value="inactive">Inativas</option></select>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredUnits.map((unit) => (
            <article key={unit.id} className="rounded-2xl border border-slate-200 p-5 shadow-sm transition hover:shadow-md">
              <div className="flex items-start justify-between gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl" style={{ color: 'var(--admin-primary)', backgroundColor: 'color-mix(in srgb, var(--admin-primary) 10%, white)' }}><Store className="h-5 w-5" /></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${unit.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{unit.status === 'active' ? 'Ativa' : 'Inativa'}</span></div>
              <h2 className="mt-4 text-lg font-black">{unit.name}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">{unit.institutionName}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-600"><p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {unit.city}/{unit.state}</p><p className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> {unit.timezone}</p><p className="text-xs font-bold uppercase text-slate-400">{unit.cashShiftMode === 'daily' ? 'Caixa diário' : 'Caixa por refeição'}</p></div>
              {unit.canEdit && <button type="button" onClick={() => openEdit(unit)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black hover:border-[var(--admin-primary)]"><Edit3 className="h-4 w-4" /> Editar unidade</button>}
            </article>
          ))}
        </div>
        {!filteredUnits.length && <div className="py-12 text-center text-sm text-slate-500">Nenhuma unidade encontrada.</div>}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-950/65 p-4">
          <form onSubmit={submit} className="my-6 w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl md:p-7">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--admin-primary)' }}>Estrutura operacional</p><h2 className="mt-1 text-2xl font-black">{form.id ? 'Editar unidade' : 'Nova unidade'}</h2></div><button type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X className="h-5 w-5" /></button></div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold md:col-span-2">Instituição<select value={form.institutionId} onChange={(event) => setForm({ ...form, institutionId: event.target.value })} required disabled={Boolean(editing) && !canManageLifecycle} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal disabled:bg-slate-100">{institutions.map((institution) => <option key={institution.id} value={institution.id} disabled={institution.status !== 'active' && institution.id !== form.institutionId}>{institution.name}{institution.status !== 'active' ? ' — inativa' : ''}</option>)}</select></label>
              <label className="text-sm font-bold md:col-span-2">Nome da unidade<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
              <label className="text-sm font-bold">Cidade<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
              <label className="text-sm font-bold">UF<input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase().slice(0, 2) })} minLength={2} maxLength={2} required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal uppercase" /></label>
              <label className="text-sm font-bold">Fuso horário<select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal">{timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
              {(!editing || canManageLifecycle) && <label className="text-sm font-bold">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as 'active' | 'inactive' })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal"><option value="active">Ativa</option><option value="inactive">Inativa</option></select></label>}
            </div>
            {editing && <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">O modo de caixa é alterado no módulo <strong>Caixas e turnos</strong>, que verifica caixas abertos antes da mudança.</div>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black">Cancelar</button><button disabled={isPending} className="rounded-xl px-5 py-3 text-sm font-black text-white disabled:opacity-50" style={{ backgroundColor: 'var(--admin-primary)' }}>{isPending ? 'Salvando...' : 'Salvar unidade'}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
