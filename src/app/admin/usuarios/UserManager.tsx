'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Edit3,
  KeyRound,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { ManagedUser, UserAccessOption } from '@/services/admin-user.service';
import type { ProfileStatus, UserRole } from '@/types/auth';
import { resendUserAccessAction, saveUserAction, type UserFormInput } from './actions';

interface Props {
  users: ManagedUser[];
  units: UserAccessOption[];
  institutions: UserAccessOption[];
  canManage: boolean;
  requesterId: string;
}

const roleLabels: Record<UserRole, string> = {
  admin_general: 'Master',
  operations_director: 'Diretor operacional',
  finance: 'Financeiro',
  supervisor: 'Supervisor',
  unit_manager: 'Gerente de unidade',
  operator: 'Operador',
  institution_user: 'Instituição',
  student: 'Consumidor',
};

const internalRoles: UserRole[] = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
  'operator',
  'institution_user',
];

const statusLabels: Record<ProfileStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
};

const emptyForm = (): UserFormInput => ({
  fullName: '',
  email: '',
  phone: '',
  role: 'operator',
  status: 'active',
  unitIds: [],
  institutionIds: [],
});

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function UserManager({ users, units, institutions, canManage, requesterId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<UserFormInput>(emptyForm);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return users.filter((user) => {
      const matchesSearch = !term ||
        user.fullName.toLocaleLowerCase('pt-BR').includes(term) ||
        user.email.toLocaleLowerCase('pt-BR').includes(term);
      return matchesSearch &&
        (roleFilter === 'all' || user.role === roleFilter) &&
        (statusFilter === 'all' || user.status === statusFilter);
    });
  }, [roleFilter, search, statusFilter, users]);

  const openCreate = () => {
    setForm(emptyForm());
    setMessage(null);
    setModalOpen(true);
  };

  const openEdit = (user: ManagedUser) => {
    setForm({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      unitIds: user.unitIds,
      institutionIds: user.institutionIds,
    });
    setMessage(null);
    setModalOpen(true);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveUserAction(form);
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      setModalOpen(false);
      setMessage({ kind: 'success', text: result.message });
      router.refresh();
    });
  };

  const resendAccess = (user: ManagedUser) => {
    setMessage(null);
    startTransition(async () => {
      const result = await resendUserAccessAction(user.id);
      setMessage(result.success
        ? { kind: 'success', text: result.message }
        : { kind: 'error', text: result.error });
    });
  };

  const activeCount = users.filter((user) => user.status === 'active').length;
  const pendingCount = users.filter((user) => user.mustChangePassword).length;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <section
        className="flex flex-col justify-between gap-5 rounded-3xl p-6 text-white shadow-xl md:flex-row md:items-end md:p-8"
        style={{ background: 'linear-gradient(135deg, var(--admin-secondary), var(--admin-primary))' }}
      >
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Segurança e equipe</p>
          <h1 className="mt-2 text-3xl font-black">Usuários e acessos</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80">
            Gerencie perfis internos, situação das contas e escopos por unidade ou instituição.
          </p>
        </div>
        {canManage && (
          <button type="button" onClick={openCreate} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black shadow-lg" style={{ color: 'var(--admin-primary)' }}>
            <Plus className="h-5 w-5" /> Convidar usuário
          </button>
        )}
      </section>

      {!canManage && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
          Seu perfil possui acesso somente para consulta. Alterações são exclusivas do Master.
        </div>
      )}
      {message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${message.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Users className="h-5 w-5" style={{ color: 'var(--admin-primary)' }} /><p className="mt-2 text-2xl font-black">{users.length}</p><p className="text-xs font-bold uppercase text-slate-500">Usuários internos</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><UserCheck className="h-5 w-5 text-emerald-600" /><p className="mt-2 text-2xl font-black">{activeCount}</p><p className="text-xs font-bold uppercase text-slate-500">Ativos</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Mail className="h-5 w-5 text-amber-600" /><p className="mt-2 text-2xl font-black">{pendingCount}</p><p className="text-xs font-bold uppercase text-slate-500">Primeiro acesso pendente</p></div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.7fr)_minmax(160px,0.6fr)]">
          <label className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou e-mail" className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-3 text-sm outline-none focus:border-[var(--admin-primary)]" />
          </label>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none">
            <option value="all">Todos os perfis</option>
            {internalRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none">
            <option value="all">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead><tr className="text-xs uppercase tracking-wide text-slate-500"><th className="border-b border-slate-200 px-3 py-3">Usuário</th><th className="border-b border-slate-200 px-3 py-3">Perfil</th><th className="border-b border-slate-200 px-3 py-3">Escopo</th><th className="border-b border-slate-200 px-3 py-3">Status</th><th className="border-b border-slate-200 px-3 py-3 text-right">Ações</th></tr></thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="border-b border-slate-100 px-3 py-3"><p className="font-bold text-slate-900">{user.fullName}{user.id === requesterId && <span className="ml-2 text-xs text-slate-400">(você)</span>}</p><p className="text-xs text-slate-500">{user.email || 'E-mail não informado'}</p></td>
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold">{roleLabels[user.role]}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-xs text-slate-600">
                    {user.unitIds.length > 0 && <p>{user.unitIds.length} unidade(s)</p>}
                    {user.institutionIds.length > 0 && <p>{user.institutionIds.length} instituição(ões)</p>}
                    {!user.unitIds.length && !user.institutionIds.length && <p>Todo o tenant</p>}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${user.status === 'active' ? 'bg-emerald-100 text-emerald-800' : user.status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-700'}`}>{statusLabels[user.status]}</span>{user.mustChangePassword && <p className="mt-1 text-[11px] font-bold text-amber-700">Aguardando ativação</p>}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-right">
                    {canManage ? <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => resendAccess(user)} disabled={isPending || user.status !== 'active'} title="Enviar link para definir ou redefinir senha" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:border-amber-500 hover:text-amber-700 disabled:opacity-40"><KeyRound className="h-3.5 w-3.5" /> Acesso</button>
                      <button type="button" onClick={() => openEdit(user)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:border-[var(--admin-primary)]"><Edit3 className="h-3.5 w-3.5" /> Editar</button>
                    </div> : <span className="text-xs text-slate-400">Consulta</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredUsers.length && <div className="py-12 text-center text-sm text-slate-500">Nenhum usuário encontrado.</div>}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-950/65 p-4">
          <form onSubmit={submit} className="my-6 w-full max-w-3xl rounded-3xl bg-white p-5 shadow-2xl md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--admin-primary)' }}>Equipe interna</p><h2 className="mt-1 text-2xl font-black">{form.id ? 'Editar usuário' : 'Convidar usuário'}</h2></div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold">Nome completo<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
              <label className="text-sm font-bold">E-mail<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" required disabled={Boolean(form.id)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal disabled:bg-slate-100" /></label>
              <label className="text-sm font-bold">Telefone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
              <label className="text-sm font-bold">Perfil<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal">{internalRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
              {form.id && <label className="text-sm font-bold">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProfileStatus })} disabled={form.id === requesterId} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal disabled:bg-slate-100">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <fieldset className="rounded-2xl border border-slate-200 p-4"><legend className="px-2 text-sm font-black"><Building2 className="mr-1 inline h-4 w-4" /> Unidades</legend><div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{units.map((unit) => <label key={unit.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={form.unitIds.includes(unit.id)} onChange={() => setForm({ ...form, unitIds: toggleId(form.unitIds, unit.id) })} className="h-4 w-4 accent-[var(--admin-primary)]" /> {unit.name}</label>)}{!units.length && <p className="text-sm text-slate-500">Nenhuma unidade cadastrada.</p>}</div></fieldset>
              <fieldset className="rounded-2xl border border-slate-200 p-4"><legend className="px-2 text-sm font-black"><ShieldCheck className="mr-1 inline h-4 w-4" /> Instituições</legend><div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{institutions.map((institution) => <label key={institution.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={form.institutionIds.includes(institution.id)} onChange={() => setForm({ ...form, institutionIds: toggleId(form.institutionIds, institution.id) })} className="h-4 w-4 accent-[var(--admin-primary)]" /> {institution.name}</label>)}{!institutions.length && <p className="text-sm text-slate-500">Nenhuma instituição cadastrada.</p>}</div></fieldset>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black">Cancelar</button>
              <button disabled={isPending} className="rounded-xl px-5 py-3 text-sm font-black text-white disabled:opacity-50" style={{ backgroundColor: 'var(--admin-primary)' }}>{isPending ? 'Salvando...' : form.id ? 'Salvar alterações' : 'Enviar convite'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
