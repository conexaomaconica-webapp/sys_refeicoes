'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Edit3, Eye, EyeOff, KeyRound, Plus, Search, Sparkles, UserCheck, Users, UserX, X } from 'lucide-react';
import {
  saveCommensalAction,
  saveConsumerAccessAction,
  type CommensalFormInput,
  type ConsumerAccessFormInput,
} from './actions';
import type { StudentAcademicStatus } from '@/types/student';

export interface SelectOption {
  id: string;
  name: string;
}

export interface CommensalListItem {
  id: string;
  user_id: string | null;
  first_access_status: string;
  institution_id: string;
  category_id: string;
  registration_number: string;
  full_name: string;
  course: string | null;
  email: string | null;
  phone: string | null;
  status: StudentAcademicStatus;
  updated_at: string;
  category_name: string;
  institution_name: string;
  access_email: string | null;
  access_status: string | null;
}

interface Props {
  students: CommensalListItem[];
  categories: SelectOption[];
  institutions: SelectOption[];
}

const statusLabels: Record<StudentAcademicStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
  cancelled: 'Cancelado',
  graduated: 'Concluído',
};

const emptyForm = (institutions: SelectOption[], categories: SelectOption[]): CommensalFormInput => ({
  institutionId: institutions[0]?.id || '',
  categoryId: categories[0]?.id || '',
  registrationNumber: '',
  fullName: '',
  course: '',
  email: '',
  phone: '',
  status: 'active',
});

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

  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

export function CommensalManager({ students, categories, institutions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [institutionFilter, setInstitutionFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<CommensalFormInput>(() => emptyForm(institutions, categories));
  const [modalOpen, setModalOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [accessStudent, setAccessStudent] = useState<CommensalListItem | null>(null);
  const [accessForm, setAccessForm] = useState<ConsumerAccessFormInput>({
    studentId: '',
    email: '',
    password: '',
    mustChangePassword: true,
    provisioningMethod: 'password',
    status: 'active',
    sendRecoveryEmail: false,
  });
  const [showAccessPassword, setShowAccessPassword] = useState(false);
  const [temporaryCredential, setTemporaryCredential] = useState<{ email: string; password: string } | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return students.filter((student) => {
      const matchesSearch = !term ||
        student.full_name.toLocaleLowerCase('pt-BR').includes(term) ||
        student.registration_number.toLocaleLowerCase('pt-BR').includes(term) ||
        (student.course || '').toLocaleLowerCase('pt-BR').includes(term);
      return matchesSearch &&
        (statusFilter === 'all' || student.status === statusFilter) &&
        (categoryFilter === 'all' || student.category_id === categoryFilter) &&
        (institutionFilter === 'all' || student.institution_id === institutionFilter);
    });
  }, [categoryFilter, institutionFilter, search, statusFilter, students]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleStudents = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openCreate = () => {
    setForm(emptyForm(institutions, categories));
    setMessage(null);
    setModalOpen(true);
  };

  const openEdit = (student: CommensalListItem) => {
    setForm({
      id: student.id,
      institutionId: student.institution_id,
      categoryId: student.category_id,
      registrationNumber: student.registration_number,
      fullName: student.full_name,
      course: student.course || '',
      email: student.email || '',
      phone: student.phone || '',
      status: student.status,
    });
    setMessage(null);
    setModalOpen(true);
  };

  const openAccess = (student: CommensalListItem) => {
    setAccessStudent(student);
    setAccessForm({
      studentId: student.id,
      email: student.access_email || student.email || '',
      password: '',
      mustChangePassword: true,
      provisioningMethod: 'password',
      status: student.access_status === 'inactive' ? 'inactive' : 'active',
      sendRecoveryEmail: false,
    });
    setShowAccessPassword(false);
    setMessage(null);
    setAccessModalOpen(true);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveCommensalAction(form);
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      setMessage({ kind: 'success', text: result.message });
      setModalOpen(false);
      router.refresh();
    });
  };

  const submitAccess = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveConsumerAccessAction(accessForm);
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if (result.temporaryCredential) {
        setTemporaryCredential(result.temporaryCredential);
        setCredentialCopied(false);
      }
      setMessage({ kind: 'success', text: result.message });
      setAccessModalOpen(false);
      setAccessStudent(null);
      router.refresh();
    });
  };

  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  const activeCount = students.filter((student) => student.status === 'active').length;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <section className="flex flex-col justify-between gap-5 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-red-950 p-6 text-white shadow-xl md:flex-row md:items-end md:p-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">Cadastro operacional</p>
          <h1 className="mt-2 text-3xl font-black">Comensais</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Consulte e corrija individualmente alunos, servidores, funcionários e outros públicos identificados.
          </p>
        </div>
        <button type="button" onClick={openCreate} disabled={!institutions.length || !categories.length} className="flex items-center justify-center gap-2 rounded-xl bg-[#F4C430] px-5 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:brightness-95 disabled:opacity-50">
          <Plus className="h-5 w-5" /> Novo comensal
        </button>
      </section>

      {message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${message.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Users className="h-5 w-5 text-red-700" /><p className="mt-2 text-2xl font-black">{students.length}</p><p className="text-xs font-bold uppercase text-slate-500">Cadastrados</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><UserCheck className="h-5 w-5 text-emerald-600" /><p className="mt-2 text-2xl font-black">{activeCount}</p><p className="text-xs font-bold uppercase text-slate-500">Ativos</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><UserX className="h-5 w-5 text-amber-600" /><p className="mt-2 text-2xl font-black">{students.length - activeCount}</p><p className="text-xs font-bold uppercase text-slate-500">Não ativos</p></div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.4fr)_repeat(3,minmax(150px,0.7fr))]">
          <label className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => updateFilter(() => setSearch(event.target.value))} placeholder="Nome, matrícula ou curso/setor" className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-3 text-sm outline-none focus:border-red-600" />
          </label>
          <select value={institutionFilter} onChange={(event) => updateFilter(() => setInstitutionFilter(event.target.value))} className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-red-600"><option value="all">Todas as instituições</option>{institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={categoryFilter} onChange={(event) => updateFilter(() => setCategoryFilter(event.target.value))} className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-red-600"><option value="all">Todas as categorias</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={statusFilter} onChange={(event) => updateFilter(() => setStatusFilter(event.target.value))} className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-red-600"><option value="all">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[850px] border-separate border-spacing-0 text-left text-sm">
            <thead><tr className="text-xs uppercase tracking-wide text-slate-500"><th className="border-b border-slate-200 px-3 py-3">Comensal</th><th className="border-b border-slate-200 px-3 py-3">Matrícula</th><th className="border-b border-slate-200 px-3 py-3">Instituição</th><th className="border-b border-slate-200 px-3 py-3">Categoria</th><th className="border-b border-slate-200 px-3 py-3">Status</th><th className="border-b border-slate-200 px-3 py-3 text-right">Ação</th></tr></thead>
            <tbody>
              {visibleStudents.map((student) => (
                <tr key={student.id} className="hover:bg-slate-50">
                  <td className="border-b border-slate-100 px-3 py-3"><p className="font-bold text-slate-900">{student.full_name}</p><p className="text-xs text-slate-500">{student.course || 'Curso/setor não informado'}</p></td>
                  <td className="border-b border-slate-100 px-3 py-3 font-mono font-bold">{student.registration_number}</td>
                  <td className="border-b border-slate-100 px-3 py-3">{student.institution_name}</td>
                  <td className="border-b border-slate-100 px-3 py-3">{student.category_name}</td>
                  <td className="border-b border-slate-100 px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${student.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{statusLabels[student.status]}</span></td>
                  <td className="border-b border-slate-100 px-3 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => openAccess(student)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:border-amber-500 hover:text-amber-700">
                        <KeyRound className="h-3.5 w-3.5" />
                        {student.first_access_status === 'pending_review' ? 'Revisar acesso' : student.user_id ? 'Acesso' : 'Criar acesso'}
                      </button>
                      <button type="button" onClick={() => openEdit(student)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold hover:border-red-500 hover:text-red-700"><Edit3 className="h-3.5 w-3.5" /> Editar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleStudents.length && <div className="py-12 text-center text-sm text-slate-500">Nenhum comensal encontrado com os filtros informados.</div>}
        </div>

        <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm sm:flex-row">
          <span className="text-slate-500">{filtered.length} resultado(s) · página {currentPage} de {totalPages}</span>
          <div className="flex gap-2"><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border px-3 py-2 font-bold disabled:opacity-40">Anterior</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border px-3 py-2 font-bold disabled:opacity-40">Próxima</button></div>
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={submit} className="max-h-dvh w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-black">{form.id ? 'Editar comensal' : 'Novo comensal'}</h2><p className="mt-1 text-sm text-slate-500">Alterações preservam o histórico de consumo e financeiro.</p></div><button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 p-2"><X className="h-5 w-5" /></button></div>
            {message?.kind === 'error' && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{message.text}</div>}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome completo</span><input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600" /></label>
              <label><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Matrícula / código</span><input required value={form.registrationNumber} onChange={(event) => setForm({ ...form, registrationNumber: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 font-mono outline-none focus:border-red-600" /></label>
              <label><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as StudentAcademicStatus })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Instituição</span><select required value={form.institutionId} onChange={(event) => setForm({ ...form, institutionId: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600">{institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Categoria</span><select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600">{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Curso ou setor</span><input value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600" /></label>
              <label><span className="mb-1 block text-xs font-bold uppercase text-slate-500">E-mail</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600" /></label>
              <label><span className="mb-1 block text-xs font-bold uppercase text-slate-500">Telefone</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600" /></label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 px-5 py-3 font-bold">Cancelar</button><button type="submit" disabled={isPending} className="rounded-xl bg-[#C5161D] px-5 py-3 font-black text-white disabled:opacity-50">{isPending ? 'Salvando...' : 'Salvar comensal'}</button></div>
          </form>
        </div>
      )}

      {accessModalOpen && accessStudent && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={submitAccess} className="max-h-dvh w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-amber-700">Portal do Consumidor</p>
                <h2 className="mt-1 text-2xl font-black">{accessStudent.user_id ? 'Gerenciar acesso' : 'Criar acesso'}</h2>
                <p className="mt-1 text-sm text-slate-500">{accessStudent.full_name} · {accessStudent.registration_number}</p>
              </div>
              <button type="button" onClick={() => setAccessModalOpen(false)} className="rounded-xl border border-slate-200 p-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
            </div>

            {message?.kind === 'error' && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{message.text}</div>}

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-slate-500">E-mail de acesso</span>
                <input type="email" required value={accessForm.email} onChange={(event) => setAccessForm({ ...accessForm, email: event.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600" />
              </label>

              {!accessStudent.user_id && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAccessForm({ ...accessForm, provisioningMethod: 'password' })}
                    className={`rounded-xl border p-3 text-left transition ${
                      accessForm.provisioningMethod === 'password'
                        ? 'border-red-600 bg-red-50/50 ring-2 ring-red-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <strong className="block text-xs font-bold text-slate-900">Senha direta</strong>
                    <span className="text-[11px] text-slate-500">Ativa sem precisar de e-mail</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccessForm({ ...accessForm, provisioningMethod: 'invite' })}
                    className={`rounded-xl border p-3 text-left transition ${
                      accessForm.provisioningMethod === 'invite'
                        ? 'border-red-600 bg-red-50/50 ring-2 ring-red-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <strong className="block text-xs font-bold text-slate-900">Convite por e-mail</strong>
                    <span className="text-[11px] text-slate-500">Envia link de ativação</span>
                  </button>
                </div>
              )}

              {/* Campo de Senha */}
              {(!accessStudent.user_id ? accessForm.provisioningMethod === 'password' : true) && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-700">
                      {accessStudent.user_id ? 'Redefinir senha (opcional)' : 'Senha de acesso (6 a 8 dígitos) *'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const pwd = generateClientStrongPassword();
                        setAccessForm((prev) => ({ ...prev, password: pwd }));
                        setShowAccessPassword(true);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-bold text-red-700 hover:text-red-800"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Gerar aleatória
                    </button>
                  </div>
                  <div className="relative mt-2">
                    <input
                      type={showAccessPassword ? 'text' : 'password'}
                      value={accessForm.password || ''}
                      onChange={(e) => setAccessForm({ ...accessForm, password: e.target.value })}
                      placeholder={accessStudent.user_id ? 'Deixe em branco para manter a atual' : 'Digite ou gere a senha'}
                      required={!accessStudent.user_id && accessForm.provisioningMethod === 'password'}
                      className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-3 pr-10 text-sm outline-none focus:border-red-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccessPassword(!showAccessPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showAccessPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <label className="mt-2.5 flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accessForm.mustChangePassword !== false}
                      onChange={(e) => setAccessForm({ ...accessForm, mustChangePassword: e.target.checked })}
                      className="h-4 w-4 rounded accent-red-600"
                    />
                    Exigir troca de senha no primeiro login
                  </label>
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Situação do acesso</span>
                <select value={accessForm.status} onChange={(event) => setAccessForm({ ...accessForm, status: event.target.value as 'active' | 'inactive' })} className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-red-600">
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>

              {accessStudent.user_id && (
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={Boolean(accessForm.sendRecoveryEmail)} onChange={(event) => setAccessForm({ ...accessForm, sendRecoveryEmail: event.target.checked })} className="mt-0.5 h-4 w-4" />
                  Enviar e-mail para o próprio consumidor redefinir sua senha
                </label>
              )}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setAccessModalOpen(false)} className="rounded-xl border border-slate-300 px-5 py-3 font-bold">Cancelar</button>
              <button type="submit" disabled={isPending} className="rounded-xl bg-[#C5161D] px-5 py-3 font-black text-white disabled:opacity-50">
                {isPending ? 'Salvando...' : accessStudent.user_id ? 'Salvar alterações' : accessForm.provisioningMethod === 'password' ? 'Criar acesso com senha' : 'Criar e enviar convite'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Exibição de Credencial Criada para o Comensal */}
      {temporaryCredential && (
        <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="consumer-cred-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">
              <KeyRound className="h-6 w-6" />
            </div>
            <h2 id="consumer-cred-title" className="mt-4 text-2xl font-black text-slate-900">
              Acesso do consumidor ativado
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              A conta do comensal foi ativada. O usuário já pode acessar o portal do consumidor em <code>/conta/login</code> com as credenciais abaixo:
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
                  onClick={async () => {
                    await navigator.clipboard.writeText(temporaryCredential.password);
                    setCredentialCopied(true);
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white hover:border-red-500 transition-colors"
                  aria-label="Copiar senha"
                  title="Copiar senha"
                >
                  {credentialCopied ? <Check className="h-5 w-5 text-emerald-700" /> : <Copy className="h-5 w-5" />}
                </button>
              </div>
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
