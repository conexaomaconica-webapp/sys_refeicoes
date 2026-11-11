'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Check,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
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
  requesterRole?: UserRole;
  allowedRoles?: UserRole[];
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

function generateClientStrongPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  const symbols = '!@#$';

  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];

  const chars = [
    pick(uppercase),
    pick(letters),
    pick(numbers),
    pick(symbols),
  ];

  const pool = letters + uppercase + numbers;
  while (chars.length < 8) {
    chars.push(pick(pool));
  }

  // Embaralha
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

const emptyForm = (defaultRole: UserRole = 'operator'): UserFormInput => ({
  fullName: '',
  email: '',
  phone: '',
  password: '',
  mustChangePassword: true,
  role: defaultRole,
  status: 'active',
  unitIds: [],
  institutionIds: [],
  provisioningMethod: 'manual_password',
});

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function UserManager({
  users,
  units,
  institutions,
  canManage,
  requesterId,
  requesterRole = 'admin_general',
  allowedRoles = internalRoles,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const defaultRoleForRequester = allowedRoles.length > 0 ? allowedRoles[allowedRoles.length - 1] : 'operator';
  const [form, setForm] = useState<UserFormInput>(() => emptyForm(defaultRoleForRequester));
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [temporaryCredential, setTemporaryCredential] = useState<{ email: string; password: string } | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);

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

  const canEditUser = (targetUser: ManagedUser) => {
    if (!canManage) return false;
    if (requesterRole === 'admin_general') return true;
    if (requesterRole === 'operations_director') {
      return targetUser.role !== 'admin_general';
    }
    if (requesterRole === 'unit_manager') {
      return targetUser.role === 'operator' && targetUser.id !== requesterId;
    }
    return false;
  };

  const openCreate = () => {
    const initialRole = allowedRoles.includes('operator') ? 'operator' : (allowedRoles[0] || 'operator');
    setForm(emptyForm(initialRole));
    setShowPassword(false);
    setPasswordNotice(null);
    setMessage(null);
    setModalOpen(true);
  };

  const openEdit = (user: ManagedUser) => {
    setForm({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      password: '',
      mustChangePassword: user.mustChangePassword,
      role: user.role,
      status: user.status,
      unitIds: user.unitIds,
      institutionIds: user.institutionIds,
      provisioningMethod: 'manual_password',
    });
    setShowPassword(false);
    setPasswordNotice(null);
    setMessage(null);
    setModalOpen(true);
  };

  const handleGeneratePassword = () => {
    const strongPassword = generateClientStrongPassword();
    setForm((prev) => ({ ...prev, password: strongPassword, provisioningMethod: 'manual_password' }));
    setShowPassword(true);
    setPasswordNotice('Senha forte gerada automaticamente.');
    setTimeout(() => setPasswordNotice(null), 4000);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (!form.id && form.provisioningMethod === 'manual_password') {
      if (!form.password || form.password.trim().length < 6) {
        setMessage({ kind: 'error', text: 'A senha informada deve ter no mínimo 6 caracteres.' });
        return;
      }
    }

    startTransition(async () => {
      const result = await saveUserAction(form);
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      setModalOpen(false);
      if (result.temporaryCredential) {
        setTemporaryCredential(result.temporaryCredential);
        setCredentialCopied(false);
      }
      setMessage({ kind: 'success', text: result.message });
      router.refresh();
    });
  };

  const copyTemporaryCredential = async () => {
    if (!temporaryCredential) return;
    await navigator.clipboard.writeText(temporaryCredential.password);
    setCredentialCopied(true);
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
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/20 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-white">
              {roleLabels[requesterRole]}
            </span>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Segurança e equipe</p>
          </div>
          <h1 className="mt-2 text-3xl font-black">Usuários e acessos</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80">
            {requesterRole === 'unit_manager'
              ? 'Cadastre e gerencie operadores vinculados às unidades sob sua gestão direta.'
              : 'Gerencie perfis internos, situação das contas e escopos por unidade ou instituição.'}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ color: 'var(--admin-primary)' }}
          >
            <Plus className="h-5 w-5" /> Criar usuário
          </button>
        )}
      </section>

      {!canManage && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
          Seu perfil possui acesso apenas para consulta. O cadastro e alterações de usuários são restritos a Master, Diretor Operacional e Gerente de Unidade.
        </div>
      )}

      {requesterRole === 'unit_manager' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
          Visão restrita ao Gerente de Unidade: você visualiza e gerencia os operadores atribuídos às suas unidades.
        </div>
      )}

      {message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${message.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Users className="h-5 w-5" style={{ color: 'var(--admin-primary)' }} />
          <p className="mt-2 text-2xl font-black">{users.length}</p>
          <p className="text-xs font-bold uppercase text-slate-500">Usuários visíveis</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <UserCheck className="h-5 w-5 text-emerald-600" />
          <p className="mt-2 text-2xl font-black">{activeCount}</p>
          <p className="text-xs font-bold uppercase text-slate-500">Ativos</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Mail className="h-5 w-5 text-amber-600" />
          <p className="mt-2 text-2xl font-black">{pendingCount}</p>
          <p className="text-xs font-bold uppercase text-slate-500">Primeiro acesso pendente</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.7fr)_minmax(160px,0.6fr)]">
          <label className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou e-mail"
              className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-3 text-sm outline-none focus:border-[var(--admin-primary)]"
            />
          </label>
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none"
          >
            <option value="all">Todos os perfis</option>
            {allowedRoles.map((role) => (
              <option key={role} value={role}>{roleLabels[role]}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none"
          >
            <option value="all">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-200 px-3 py-3">Usuário</th>
                <th className="border-b border-slate-200 px-3 py-3">Perfil</th>
                <th className="border-b border-slate-200 px-3 py-3">Escopo</th>
                <th className="border-b border-slate-200 px-3 py-3">Status</th>
                <th className="border-b border-slate-200 px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const editable = canEditUser(user);
                return (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-3 py-3">
                      <p className="font-bold text-slate-900">
                        {user.fullName}
                        {user.id === requesterId && <span className="ml-2 text-xs text-slate-400">(você)</span>}
                      </p>
                      <p className="text-xs text-slate-500">{user.email || 'E-mail não informado'}</p>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 font-semibold">
                      {roleLabels[user.role]}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 text-xs text-slate-600">
                      {user.unitIds.length > 0 && <p>{user.unitIds.length} unidade(s)</p>}
                      {user.institutionIds.length > 0 && <p>{user.institutionIds.length} instituição(ões)</p>}
                      {!user.unitIds.length && !user.institutionIds.length && <p>Todo o tenant</p>}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${user.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : user.status === 'suspended'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                        {statusLabels[user.status]}
                      </span>
                      {user.mustChangePassword && (
                        <p className="mt-1 text-[11px] font-bold text-amber-700">Aguardando ativação</p>
                      )}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 text-right">
                      {editable ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => resendAccess(user)}
                            disabled={isPending || user.status !== 'active'}
                            title="Enviar link para redefinir senha"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:border-amber-500 hover:text-amber-700 disabled:opacity-40"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Acesso
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:border-[var(--admin-primary)]"
                          >
                            <Edit3 className="h-3.5 w-3.5" /> Editar
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Consulta</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredUsers.length && (
            <div className="py-12 text-center text-sm text-slate-500">Nenhum usuário encontrado.</div>
          )}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-950/65 p-4">
          <form onSubmit={submit} className="my-6 w-full max-w-3xl rounded-3xl bg-white p-5 shadow-2xl md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--admin-primary)' }}>
                  Gestão de equipe
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {form.id ? 'Editar usuário' : 'Cadastrar novo usuário'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold">
                Nome completo *
                <input
                  value={form.fullName}
                  onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                  placeholder="Ex: João da Silva"
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:border-[var(--admin-primary)]"
                />
              </label>

              <label className="text-sm font-bold">
                E-mail corporativo *
                <input
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  placeholder="exemplo@empresa.com"
                  type="email"
                  required
                  disabled={Boolean(form.id)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal disabled:bg-slate-100 outline-none focus:border-[var(--admin-primary)]"
                />
              </label>

              <label className="text-sm font-bold">
                Telefone / Celular
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  placeholder="(00) 00000-0000"
                  type="tel"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:border-[var(--admin-primary)]"
                />
              </label>

              <label className="text-sm font-bold">
                Perfil de acesso *
                <select
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}
                  disabled={allowedRoles.length <= 1}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal disabled:bg-slate-100 outline-none focus:border-[var(--admin-primary)]"
                >
                  {allowedRoles.map((role) => (
                    <option key={role} value={role}>{roleLabels[role]}</option>
                  ))}
                </select>
              </label>

              {form.id && (
                <label className="text-sm font-bold">
                  Status da conta
                  <select
                    value={form.status}
                    onChange={(event) => setForm({ ...form, status: event.target.value as ProfileStatus })}
                    disabled={form.id === requesterId}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal disabled:bg-slate-100 outline-none focus:border-[var(--admin-primary)]"
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/* Configuração de Senha e Credenciais */}
            {!form.id ? (
              <fieldset className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 md:p-5">
                <legend className="px-2 text-sm font-black text-slate-800">
                  <KeyRound className="mr-1 inline h-4 w-4" style={{ color: 'var(--admin-primary)' }} />
                  Definição de senha e acesso
                </legend>

                {/* Métodos de provisionamento */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, provisioningMethod: 'manual_password' })}
                    className={`flex items-center justify-between rounded-xl border p-3 text-left transition-colors ${form.provisioningMethod === 'manual_password'
                        ? 'border-red-600 bg-white ring-2 ring-red-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                  >
                    <div>
                      <strong className="block text-sm text-slate-900">Cadastrar com senha direta</strong>
                      <span className="text-xs text-slate-500">Defina ou gere uma senha agora sem convite</span>
                    </div>
                    {form.provisioningMethod === 'manual_password' && (
                      <Check className="h-4 w-4 text-red-600" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, provisioningMethod: 'invite' })}
                    className={`flex items-center justify-between rounded-xl border p-3 text-left transition-colors ${form.provisioningMethod === 'invite'
                        ? 'border-red-600 bg-white ring-2 ring-red-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                  >
                    <div>
                      <strong className="block text-sm text-slate-900">Enviar convite por e-mail</strong>
                      <span className="text-xs text-slate-500">O usuário receberá o link para criar a senha</span>
                    </div>
                    {form.provisioningMethod === 'invite' && (
                      <Check className="h-4 w-4 text-red-600" />
                    )}
                  </button>
                </div>

                {form.provisioningMethod === 'manual_password' && (
                  <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <label className="text-sm font-bold text-slate-800">
                        Senha de acesso inicial (6 a 8 caracteres) *
                      </label>
                      <button
                        type="button"
                        onClick={handleGeneratePassword}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 hover:text-red-800 active:scale-95"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Gerar senha aleatória (8 dígitos)
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={form.password || ''}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                        placeholder="Entre 6 e 8 caracteres (mínimo 6)"
                        required={form.provisioningMethod === 'manual_password'}
                        className="w-full rounded-xl border border-slate-300 py-3 pl-3 pr-10 text-sm font-medium outline-none focus:border-[var(--admin-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                        title={showPassword ? 'Ocultar senha' : 'Ver senha'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {passwordNotice && (
                      <p className="text-xs font-bold text-emerald-700 animate-fadeIn">
                        {passwordNotice}
                      </p>
                    )}

                    <label className="flex items-center gap-2 pt-1 text-xs font-bold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.mustChangePassword !== false}
                        onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })}
                        className="h-4 w-4 rounded accent-[var(--admin-primary)]"
                      />
                      Exigir alteração de senha no primeiro login do usuário
                    </label>
                  </div>
                )}
              </fieldset>
            ) : (
              /* Campo opcional de redefinição de senha na edição */
              <fieldset className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                  <KeyRound className="mr-1 inline h-3.5 w-3.5" /> Redefinir senha (opcional)
                </legend>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Nova senha do usuário</label>
                    <button
                      type="button"
                      onClick={handleGeneratePassword}
                      className="inline-flex items-center gap-1 text-xs font-bold text-red-700 hover:text-red-800"
                    >
                      <Sparkles className="h-3 w-3" /> Gerar aleatória
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password || ''}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      placeholder="Deixe em branco para manter a senha atual"
                      className="w-full rounded-xl border border-slate-300 py-2.5 pl-3 pr-10 text-sm outline-none focus:border-[var(--admin-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </fieldset>
            )}

            {/* Escopos de Unidades e Instituições */}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <fieldset className="rounded-2xl border border-slate-200 p-4">
                <legend className="px-2 text-sm font-black">
                  <Building2 className="mr-1 inline h-4 w-4" /> Unidades atribuídas
                </legend>
                {requesterRole === 'unit_manager' && (
                  <p className="mb-2 text-xs text-slate-500">
                    Selecione ao menos uma unidade sob sua gerência:
                  </p>
                )}
                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                  {units.map((unit) => (
                    <label
                      key={unit.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.unitIds.includes(unit.id)}
                        onChange={() => setForm({ ...form, unitIds: toggleId(form.unitIds, unit.id) })}
                        className="h-4 w-4 accent-[var(--admin-primary)]"
                      />
                      {unit.name}
                    </label>
                  ))}
                  {!units.length && (
                    <p className="text-sm text-slate-500">Nenhuma unidade disponível no seu escopo.</p>
                  )}
                </div>
              </fieldset>

              <fieldset className="rounded-2xl border border-slate-200 p-4">
                <legend className="px-2 text-sm font-black">
                  <ShieldCheck className="mr-1 inline h-4 w-4" /> Instituições
                </legend>
                {requesterRole === 'unit_manager' ? (
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                    Gerentes de unidade têm escopo baseado nas unidades vinculadas.
                  </p>
                ) : (
                  <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                    {institutions.map((institution) => (
                      <label
                        key={institution.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={form.institutionIds.includes(institution.id)}
                          onChange={() => setForm({ ...form, institutionIds: toggleId(form.institutionIds, institution.id) })}
                          className="h-4 w-4 accent-[var(--admin-primary)]"
                        />
                        {institution.name}
                      </label>
                    ))}
                    {!institutions.length && (
                      <p className="text-sm text-slate-500">Nenhuma instituição cadastrada.</p>
                    )}
                  </div>
                )}
              </fieldset>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                disabled={isPending}
                className="rounded-xl px-5 py-3 text-sm font-black text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: 'var(--admin-primary)' }}
              >
                {isPending
                  ? 'Salvando...'
                  : form.id
                    ? 'Salvar alterações'
                    : form.provisioningMethod === 'manual_password'
                      ? 'Cadastrar usuário'
                      : 'Enviar convite'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Exibição de Credencial Criada */}
      {temporaryCredential && (
        <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/70 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="temporary-password-title"
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8"
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">
              <KeyRound className="h-6 w-6" />
            </div>
            <h2 id="temporary-password-title" className="mt-4 text-2xl font-black text-slate-900">
              Credenciais de acesso criadas
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              A conta foi criada com sucesso no sistema. Entregue os dados ao usuário por um canal seguro.
            </p>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">E-mail de login</p>
              <p className="mt-1 break-all font-bold text-slate-900">{temporaryCredential.email}</p>

              <p className="mt-4 text-xs font-black uppercase tracking-wide text-slate-500">Senha definida</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-3 text-sm font-bold text-slate-950 ring-1 ring-slate-200">
                  {temporaryCredential.password}
                </code>
                <button
                  type="button"
                  onClick={copyTemporaryCredential}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white hover:border-red-500 transition-colors"
                  aria-label="Copiar senha"
                  title="Copiar senha"
                >
                  {credentialCopied ? <Check className="h-5 w-5 text-emerald-700" /> : <Copy className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
              Se a troca obrigatória estiver habilitada, o usuário deverá criar uma senha definitiva pessoal no primeiro acesso.
            </div>
            <button
              type="button"
              onClick={() => {
                setTemporaryCredential(null);
                setCredentialCopied(false);
              }}
              className="mt-6 w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white hover:bg-red-600 transition-colors"
            >
              Concluir e fechar
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
