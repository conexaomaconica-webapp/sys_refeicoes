'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  adminListCategories,
  adminSaveCategory,
  listMealTypes,
  type MealTypeOption,
} from '@/services/categories.service';
import type { StudentCategory } from '@/types/student';
import {
  Layers,
  Plus,
  Edit2,
  CheckCircle2,
  Percent,
  DollarSign,
  Wallet,
  Repeat,
  UtensilsCrossed,
  ArrowLeft,
  Users,
  Search,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<StudentCategory[]>([]);
  const [mealTypes, setMealTypes] = useState<MealTypeOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<Partial<StudentCategory> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [catRes, mtRes] = await Promise.all([adminListCategories(), listMealTypes()]);

    if (catRes.success) {
      setCategories(catRes.categories);
    } else {
      setFeedback({ type: 'error', message: catRes.error || 'Erro ao carregar categorias.' });
    }

    if (mtRes.success) {
      setMealTypes(mtRes.mealTypes);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenCreateModal = () => {
    setEditingCategory({
      code: '',
      name: '',
      description: '',
      pricing_type: 'percentage',
      charge_percentage: 100,
      fixed_price: null,
      requires_wallet: true,
      allow_multi_meal: false,
      payment_mode: 'wallet',
      allowed_meal_types: null,
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cat: StudentCategory) => {
    setEditingCategory({
      ...cat,
      allowed_meal_types: cat.allowed_meal_types || null,
    });
    setIsModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || isSaving) return;

    if (!editingCategory.name?.trim() || !editingCategory.code?.trim()) {
      setFeedback({ type: 'error', message: 'Preencha o nome e o código da categoria.' });
      return;
    }

    setIsSaving(true);
    const res = await adminSaveCategory(editingCategory);
    setIsSaving(false);

    if (res.success) {
      setFeedback({ type: 'success', message: `Categoria "${editingCategory.name}" salva com sucesso!` });
      setIsModalOpen(false);
      loadData();
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({ type: 'error', message: res.error || 'Falha ao salvar categoria.' });
    }
  };

  const filteredCategories = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="theme-light-page min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* 1. TOPO DE NAVEGAÇÃO E BRANDING */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/terminal"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
            title="Voltar ao Terminal"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="p-2.5 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Gestão de Categorias de Comensais
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono border border-sky-400/30">
                Admin
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Configure regras de subsídio, porcentagem, valor fixo, recarga e refeições liberadas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/20 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Categoria</span>
          </button>
        </div>
      </header>

      {/* FEEDBACK BANNER */}
      {feedback && (
        <div
          className={`px-6 py-3 text-xs font-semibold flex items-center justify-between border-b ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-200'
              : 'bg-red-950/80 border-red-500/30 text-red-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* 2. CONTEÚDO PRINCIPAL */}
      <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">
        {/* KPI CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-sky-400" />
              <span>Categorias Ativas</span>
            </p>
            <p className="text-2xl font-black text-white font-mono">
              {categories.filter((c) => c.status === 'active').length}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>Comensais Vinculados</span>
            </p>
            <p className="text-2xl font-black text-emerald-400 font-mono">
              {categories.reduce((acc, c) => acc + (c.total_students || 0), 0)}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-amber-400" />
              <span>Com Carteira Ativa</span>
            </p>
            <p className="text-2xl font-black text-amber-400 font-mono">
              {categories.filter((c) => c.requires_wallet).length}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Repeat className="w-4 h-4 text-purple-400" />
              <span>Multi-Refeição</span>
            </p>
            <p className="text-2xl font-black text-purple-400 font-mono">
              {categories.filter((c) => c.allow_multi_meal).length}
            </p>
          </div>
        </div>

        {/* BUSCA E TABELA */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-6 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou código..."
                className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="text-xs text-slate-400">
              Mostrando <span className="text-white font-bold font-mono">{filteredCategories.length}</span> categoria(s)
            </div>
          </div>

          {/* LISTA / TABELA */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Categoria</th>
                  <th className="px-6 py-4">Cobrança / Subsídio</th>
                  <th className="px-6 py-4">Pagamento & Carteira</th>
                  <th className="px-6 py-4">Multi-Refeição</th>
                  <th className="px-6 py-4">Refeições Permitidas</th>
                  <th className="px-6 py-4">Comensais</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredCategories.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-500">
                      Nenhuma categoria encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredCategories.map((cat) => (
                    <tr key={cat.id} className="hover:bg-slate-800/30 transition-all">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span>{cat.name}</span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-semibold">
                            {cat.code}
                          </span>
                        </div>
                        {cat.description && (
                          <p className="text-[11px] text-slate-500 mt-0.5 max-w-xs truncate">{cat.description}</p>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        {cat.pricing_type === 'percentage' ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold ${
                                cat.charge_percentage === 0
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : cat.charge_percentage === 100
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {cat.charge_percentage === 0 ? '0% (Isento)' : `${cat.charge_percentage}% Cobrado`}
                            </span>
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg bg-sky-500/20 text-sky-300 font-mono font-bold text-xs border border-sky-500/30">
                            R$ {(cat.fixed_price || 0).toFixed(2)} Fixo
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4 space-y-1">
                        <div>
                          {cat.payment_mode === 'on_entry' ? (
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[10px] font-bold">
                              Pago na Entrada (Avulso)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-bold">
                              Débito em Carteira
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {cat.requires_wallet ? '✓ Permite recarga' : '✗ Sem recarga de saldo'}
                        </p>
                      </td>

                      <td className="px-6 py-4">
                        {cat.allow_multi_meal ? (
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/30 font-bold text-[10px] flex items-center gap-1 w-fit">
                            <Repeat className="w-3 h-3" />
                            <span>Múltiplas Refeições</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">1 refeição por turno</span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        {!cat.allowed_meal_types || cat.allowed_meal_types.length === 0 ? (
                          <span className="text-[11px] text-emerald-400 font-semibold">Todas as Refeições</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {cat.allowed_meal_types.map((mtId) => {
                              const mt = mealTypes.find((m) => m.id === mtId);
                              return (
                                <span
                                  key={mtId}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[9px]"
                                >
                                  {mt ? mt.name : 'Refeição'}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-mono text-slate-200 font-bold">{cat.total_students || 0}</span>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleOpenEditModal(cat)}
                          className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-semibold cursor-pointer transition-all inline-flex items-center gap-1.5"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-sky-400" />
                          <span>Editar</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 3. MODAL DE CADASTRO E EDIÇÃO DE CATEGORIA */}
      {isModalOpen && editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="terminal-light-surface bg-white border border-slate-300 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl text-slate-900 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">
                    {editingCategory.id ? 'Editar Categoria' : 'Cadastrar Nova Categoria'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Defina as regras de precificação, recarga e refeições autorizadas.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-5 text-xs">
              {/* Nome e Código */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-300">Nome da Categoria *</label>
                  <input
                    type="text"
                    required
                    value={editingCategory.name || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                    placeholder="Ex: Servidores / Docentes"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-300">Código Único (Slug) *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingCategory.id}
                    value={editingCategory.code || ''}
                    onChange={(e) =>
                      setEditingCategory({
                        ...editingCategory,
                        code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                      })
                    }
                    placeholder="Ex: servidor, bolsista_50"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono disabled:opacity-50 focus:outline-none focus:border-sky-500"
                  />
                  <p className="text-[10px] text-slate-500">Minúsculo e sem espaços (ex: visitante, servidor).</p>
                </div>
              </div>

              {/* Descrição */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300">Descrição Operacional</label>
                <input
                  type="text"
                  value={editingCategory.description || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                  placeholder="Ex: Servidores efetivos e terceirizados da instituição"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* REGRA DE COBRANÇA */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <label className="font-bold text-sky-400 text-xs flex items-center gap-1.5">
                  <Percent className="w-4 h-4" />
                  <span>Política de Cobrança da Refeição</span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingCategory({ ...editingCategory, pricing_type: 'percentage' })}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      editingCategory.pricing_type === 'percentage'
                        ? 'bg-sky-500/20 border-sky-500 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <Percent className="w-4 h-4" />
                      <span>Porcentagem (%)</span>
                    </div>
                    <p className="text-[10px] mt-1 text-slate-400">
                      Calcula com base no valor da refeição (ex: 0% isento, 100% integral).
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingCategory({ ...editingCategory, pricing_type: 'fixed' })}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      editingCategory.pricing_type === 'fixed'
                        ? 'bg-sky-500/20 border-sky-500 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <DollarSign className="w-4 h-4" />
                      <span>Valor Fixo (R$)</span>
                    </div>
                    <p className="text-[10px] mt-1 text-slate-400">
                      Cobra um valor pré-determinado fixo (ex: R$ 3,50 por refeição).
                    </p>
                  </button>
                </div>

                {editingCategory.pricing_type === 'percentage' ? (
                  <div className="space-y-1.5 pt-1">
                    <label className="font-semibold text-slate-300">
                      Porcentagem de Cobrança (% paga pelo comensal)
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={editingCategory.charge_percentage ?? 100}
                        onChange={(e) =>
                          setEditingCategory({ ...editingCategory, charge_percentage: Number(e.target.value) })
                        }
                        className="w-32 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono text-center font-bold"
                      />
                      <span className="text-slate-400 font-mono text-xs">
                        {editingCategory.charge_percentage === 0
                          ? '👉 100% Subsidiado (Bolsista Isento - R$ 0,00)'
                          : editingCategory.charge_percentage === 100
                          ? '👉 Valor Integral (Sem subsídio público)'
                          : `👉 Paga ${editingCategory.charge_percentage}% da refeição, instituição subsidia ${
                              100 - (editingCategory.charge_percentage || 0)
                            }%`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 pt-1">
                    <label className="font-semibold text-slate-300">Valor Fixo da Refeição (R$)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.10"
                      value={editingCategory.fixed_price ?? 3.5}
                      onChange={(e) => setEditingCategory({ ...editingCategory, fixed_price: Number(e.target.value) })}
                      className="w-32 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono text-center font-bold"
                    />
                  </div>
                )}
              </div>

              {/* FORMA DE PAGAMENTO E CARTEIRA */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <label className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                  <Wallet className="w-4 h-4" />
                  <span>Pagamento & Carteira</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingCategory({
                        ...editingCategory,
                        payment_mode: 'wallet',
                        requires_wallet: true,
                      })
                    }
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      editingCategory.payment_mode === 'wallet'
                        ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <Wallet className="w-4 h-4 text-emerald-400" />
                      <span>Carteira Digital</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Debita saldo pré-carregado no cartão/matrícula do comensal.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEditingCategory({
                        ...editingCategory,
                        payment_mode: 'on_entry',
                        requires_wallet: false,
                        allow_multi_meal: true,
                      })
                    }
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      editingCategory.payment_mode === 'on_entry'
                        ? 'bg-rose-500/20 border-rose-500 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <DollarSign className="w-4 h-4 text-rose-400" />
                      <span>Pago na Entrada (Visitante)</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Pago no balcão/recepção na hora da entrada. Não exige saldo na carteira.
                    </p>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingCategory.requires_wallet ?? false}
                      onChange={(e) =>
                        setEditingCategory({ ...editingCategory, requires_wallet: e.target.checked })
                      }
                      className="w-4 h-4 rounded text-sky-500 bg-slate-900 border-slate-700"
                    />
                    <span className="text-slate-300 font-semibold">Permite Recarregar Carteira</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingCategory.allow_multi_meal ?? false}
                      onChange={(e) =>
                        setEditingCategory({ ...editingCategory, allow_multi_meal: e.target.checked })
                      }
                      className="w-4 h-4 rounded text-purple-500 bg-slate-900 border-slate-700"
                    />
                    <span className="text-slate-300 font-semibold">
                      Permite Múltiplas Refeições (Sem trava de cota diária)
                    </span>
                  </label>
                </div>
              </div>

              {/* REFEIÇÕES AUTORIZADAS */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-amber-400 text-xs flex items-center gap-1.5">
                    <UtensilsCrossed className="w-4 h-4" />
                    <span>Tipos de Refeições Permitidas</span>
                  </label>
                  <span className="text-[10px] text-slate-500">
                    Se nenhum for selecionado, todas as refeições serão liberadas.
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  {mealTypes.map((mt) => {
                    const isChecked = editingCategory.allowed_meal_types?.includes(mt.id);
                    return (
                      <label
                        key={mt.id}
                        className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                          isChecked
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked || false}
                          onChange={(e) => {
                            const current = editingCategory.allowed_meal_types || [];
                            const next = e.target.checked
                              ? [...current, mt.id]
                              : current.filter((id) => id !== mt.id);
                            setEditingCategory({
                              ...editingCategory,
                              allowed_meal_types: next.length > 0 ? next : null,
                            });
                          }}
                          className="w-3.5 h-3.5 rounded text-amber-500"
                        />
                        <span className="font-semibold">{mt.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* BOTÕES DE AÇÃO */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold shadow-lg shadow-sky-500/20 cursor-pointer flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSaving ? 'Salvando...' : 'Salvar Categoria'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
