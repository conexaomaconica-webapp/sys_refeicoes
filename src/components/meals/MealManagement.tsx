'use client';

import React, { useState } from 'react';
import type { MealRule, MealType, UnitMealType } from '@/types/meal';

interface StudentCategoryOption {
  id: string;
  code: string;
  name: string;
  requires_wallet: boolean;
}

interface UnitOption {
  id: string;
  name: string;
}

interface MealManagementProps {
  units: UnitOption[];
  mealTypes: MealType[];
  initialUnitMealTypes: UnitMealType[];
  initialMealRules: MealRule[];
  categories: StudentCategoryOption[];
  onSaveUnitMealType: (unitId: string, mealTypeId: string, enabled: boolean, startTime?: string, endTime?: string) => Promise<{ success: boolean; error?: string }>;
  onSaveMealRule: (unitId: string, mealTypeId: string, categoryId: string, fullPrice: number, studentPrice: number) => Promise<{ success: boolean; error?: string }>;
}

export function MealManagement({
  units,
  mealTypes,
  initialUnitMealTypes,
  initialMealRules,
  categories,
  onSaveUnitMealType,
  onSaveMealRule,
}: MealManagementProps) {
  const [selectedUnitId, setSelectedUnitId] = useState<string>(units[0]?.id || '');
  const [unitMealTypes, setUnitMealTypes] = useState<UnitMealType[]>(initialUnitMealTypes);
  const [mealRules, setMealRules] = useState<MealRule[]>(initialMealRules);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Selecionadores de formulário para nova regra
  const [selectedMealTypeId, setSelectedMealTypeId] = useState<string>(mealTypes[0]?.id || '');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(categories[0]?.id || '');
  const [inputFullPrice, setInputFullPrice] = useState<string>('12.00');
  const [inputStudentPrice, setInputStudentPrice] = useState<string>('4.00');

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const isIntegralCategory = selectedCategory?.code === 'integral' || selectedCategory?.requires_wallet === false;

  const currentRulesForUnit = mealRules.filter((r) => r.unit_id === selectedUnitId);

  const handleToggleMealType = async (mealTypeId: string, currentlyEnabled: boolean) => {
    setLoading(true);
    setMessage(null);
    const existing = unitMealTypes.find((u) => u.unit_id === selectedUnitId && u.meal_type_id === mealTypeId);
    const res = await onSaveUnitMealType(
      selectedUnitId,
      mealTypeId,
      !currentlyEnabled,
      existing?.start_time || undefined,
      existing?.end_time || undefined
    );

    if (res.success) {
      setMessage({ type: 'success', text: 'Status da refeição atualizado com sucesso nesta unidade.' });
      setUnitMealTypes((prev) => {
        const index = prev.findIndex((u) => u.unit_id === selectedUnitId && u.meal_type_id === mealTypeId);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = { ...updated[index], enabled: !currentlyEnabled };
          return updated;
        }
        return [...prev, { id: 'temp-' + Date.now(), tenant_id: '', unit_id: selectedUnitId, meal_type_id: mealTypeId, enabled: !currentlyEnabled, start_time: null, end_time: null, created_at: '', updated_at: '' }];
      });
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao atualizar refeição da unidade.' });
    }
    setLoading(false);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const full = parseFloat(inputFullPrice);
    const student = isIntegralCategory ? 0 : parseFloat(inputStudentPrice);

    if (isNaN(full) || full < 0) {
      setMessage({ type: 'error', text: 'Preço cheio inválido.' });
      setLoading(false);
      return;
    }

    if (isNaN(student) || student < 0) {
      setMessage({ type: 'error', text: 'Preço do aluno inválido.' });
      setLoading(false);
      return;
    }

    if (student > full) {
      setMessage({ type: 'error', text: 'O preço do aluno não pode exceder o valor cheio da refeição.' });
      setLoading(false);
      return;
    }

    const res = await onSaveMealRule(selectedUnitId, selectedMealTypeId, selectedCategoryId, full, student);

    if (res.success) {
      setMessage({ type: 'success', text: 'Tabela de preço e subsídio atualizada com sucesso (histórico preservado).' });
      // Atualizar lista de regras exibida
      const subsidy = full - student;
      const mealType = mealTypes.find((m) => m.id === selectedMealTypeId);
      setMealRules((prev) => [
        ...prev.filter((r) => !(r.unit_id === selectedUnitId && r.meal_type_id === selectedMealTypeId && r.category_id === selectedCategoryId)),
        {
          id: 'rule-' + Date.now(),
          tenant_id: '',
          unit_id: selectedUnitId,
          meal_type_id: selectedMealTypeId,
          category_id: selectedCategoryId,
          full_price: full,
          student_price: student,
          subsidy_amount: subsidy,
          enabled: true,
          effective_from: new Date().toISOString(),
          effective_to: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          meal_type: mealType,
        },
      ]);
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao definir regra de preço.' });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-8 p-6 bg-slate-900 text-slate-100 rounded-xl shadow-2xl border border-slate-800">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Gestão de Refeições & Preços</h2>
          <p className="text-sm text-slate-400">Configure vigências, subsídios e tipos de refeição por unidade operacional.</p>
        </div>

        {/* Seleção de Unidade Operacional */}
        <div className="flex items-center space-x-3 bg-slate-800/80 p-2.5 rounded-lg border border-slate-700">
          <label htmlFor="unit-select" className="text-sm font-semibold text-slate-300">Unidade:</label>
          <select
            id="unit-select"
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            className="bg-slate-900 text-slate-100 text-sm font-medium px-3 py-1.5 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg text-sm font-medium flex items-center justify-between ${
            message.type === 'success' ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-300' : 'bg-rose-950/80 border border-rose-700 text-rose-300'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-xs opacity-70 hover:opacity-100">
            Fechar
          </button>
        </div>
      )}

      {/* Grid de Configurações */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 1. Habilitação de Refeições por Unidade */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700/60 space-y-6">
          <h3 className="text-lg font-semibold text-emerald-400 border-b border-slate-700 pb-3 flex items-center gap-2">
            <span>☕ Refeições Habilitadas na Unidade</span>
          </h3>

          <div className="space-y-4">
            {mealTypes.map((mt) => {
              const uMeal = unitMealTypes.find((u) => u.unit_id === selectedUnitId && u.meal_type_id === mt.id);
              const isEnabled = uMeal ? uMeal.enabled : true;

              return (
                <div
                  key={mt.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition"
                >
                  <div>
                    <span className="font-semibold text-white block">{mt.name}</span>
                    <span className="text-xs text-slate-400 uppercase tracking-wider">{mt.code}</span>
                  </div>

                  <button
                    disabled={loading}
                    onClick={() => handleToggleMealType(mt.id, isEnabled)}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all shadow-md ${
                      isEnabled
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                    }`}
                  >
                    {isEnabled ? 'Habilitada' : 'Desabilitada'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Formulário de Cadastro/Atualização de Regra de Preço */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700/60 space-y-6">
          <h3 className="text-lg font-semibold text-emerald-400 border-b border-slate-700 pb-3">
            <span>💲 Atualizar Preço e Subsídio</span>
          </h3>

          <form onSubmit={handleSaveRule} className="space-y-4">
            <div>
              <label htmlFor="meal-type-select" className="block text-xs font-medium text-slate-300 mb-1">Tipo de Refeição</label>
              <select
                id="meal-type-select"
                value={selectedMealTypeId}
                onChange={(e) => setSelectedMealTypeId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500"
              >
                {mealTypes.map((mt) => (
                  <option key={mt.id} value={mt.id}>
                    {mt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="category-select" className="block text-xs font-medium text-slate-300 mb-1">Categoria de Aluno</label>
              <select
                id="category-select"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="full-price-input" className="block text-xs font-medium text-slate-300 mb-1">Preço Cheio (R$)</label>
                <input
                  id="full-price-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputFullPrice}
                  onChange={(e) => setInputFullPrice(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="student-price-input" className="block text-xs font-medium text-slate-300 mb-1">Preço Aluno (R$)</label>
                <input
                  id="student-price-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={isIntegralCategory ? '0.00' : inputStudentPrice}
                  onChange={(e) => setInputStudentPrice(e.target.value)}
                  disabled={isIntegralCategory}
                  className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:ring-2 focus:ring-emerald-500 ${
                    isIntegralCategory ? 'opacity-60 cursor-not-allowed text-emerald-400 font-bold' : ''
                  }`}
                  required
                />
              </div>
            </div>

            {/* Cálculo em tempo real do subsídio */}
            <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 text-xs flex justify-between items-center text-slate-300">
              <span>Subsídio Calculado:</span>
              <span className="font-bold text-emerald-400 text-sm">
                R$ {(Math.max(0, parseFloat(inputFullPrice || '0') - (isIntegralCategory ? 0 : parseFloat(inputStudentPrice || '0')))).toFixed(2)}
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-lg transition shadow-lg shadow-emerald-950/50"
            >
              {loading ? 'Salvando...' : 'Salvar Regra de Preço'}
            </button>
          </form>
        </div>
      </div>

      {/* 3. Tabela de Vigências Ativas */}
      <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700/60 space-y-4">
        <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-3">
          Tabela Vigente de Preços nesta Unidade
        </h3>

        {currentRulesForUnit.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-4">Nenhuma regra de preço configurada para esta unidade.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900 text-xs uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Refeição</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4 text-right">Preço Cheio</th>
                  <th className="py-3 px-4 text-right">Preço Aluno</th>
                  <th className="py-3 px-4 text-right">Subsídio</th>
                  <th className="py-3 px-4 text-center">Vigência Desde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {currentRulesForUnit.map((rule) => {
                  const mealName = mealTypes.find((m) => m.id === rule.meal_type_id)?.name || 'Refeição';
                  const catName = categories.find((c) => c.id === rule.category_id)?.name || 'Categoria';

                  return (
                    <tr key={rule.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-semibold text-white">{mealName}</td>
                      <td className="py-3 px-4">{catName}</td>
                      <td className="py-3 px-4 text-right text-slate-300">R$ {Number(rule.full_price).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-semibold text-emerald-400">R$ {Number(rule.student_price).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-slate-400">R$ {Number(rule.subsidy_amount).toFixed(2)}</td>
                      <td className="py-3 px-4 text-center text-xs text-slate-400">
                        {new Date(rule.effective_from).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
