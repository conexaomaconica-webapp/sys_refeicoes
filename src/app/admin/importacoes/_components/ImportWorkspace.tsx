'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, ShieldAlert, Upload, XCircle } from 'lucide-react';
import type { ImportPreviewResult, ImportRowAction } from '@/types/import';
import { cancelImportAction, confirmImportAction, createImportPreviewAction } from '../actions';

type Institution = { id: string; name: string; short_name: string | null };
type RecentImport = { id: string; original_filename: string; status: string; total_rows: number; error_rows: number; created_at: string };
type Filter = 'all' | 'valid' | ImportRowAction;

const actionLabels: Record<ImportRowAction, string> = {
  insert: 'Inserir',
  update: 'Atualizar',
  reclassify_partial: 'Reclassificar para parcial',
  ignore: 'Ignorar',
  error: 'Inválida',
};

export function ImportWorkspace({ institutions, recentImports }: { institutions: Institution[]; recentImports: RecentImport[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    const rows = filter === 'all'
      ? preview.rows
      : filter === 'valid'
        ? preview.rows.filter((row) => ['insert', 'update', 'reclassify_partial'].includes(row.action))
        : preview.rows.filter((row) => row.action === filter);
    return rows.slice(0, 250);
  }, [filter, preview]);

  function submitPreview(formData: FormData) {
    setMessage(null);
    setConfirmed(false);
    startTransition(async () => {
      const result = await createImportPreviewAction(formData);
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      setPreview(result.data);
      setCompleted(false);
      setFilter('all');
    });
  }

  function confirmImport() {
    if (!preview || !confirmed) return;
    setMessage(null);
    startTransition(async () => {
      const result = await confirmImportAction(preview.import_id);
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      setMessage({
        kind: 'success',
        text: `Importação concluída: ${result.data.processed} processadas, ${result.data.failed} falhas e ${result.data.skipped} rejeitadas/ignoradas.`,
      });
      setConfirmed(false);
      setCompleted(true);
    });
  }

  function cancelImport() {
    if (!preview) return;
    startTransition(async () => {
      const result = await cancelImportAction(preview.import_id);
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      setPreview(null);
      setMessage({ kind: 'success', text: 'Preview cancelado sem alterar cadastros de alunos.' });
    });
  }

  const summary = preview?.summary;
  const cards = summary ? [
    ['Total', summary.total_rows, 'all' as Filter],
    ['Válidas', summary.valid_rows, 'valid' as Filter],
    ['Inserções', summary.insert_rows, 'insert' as Filter],
    ['Atualizações', summary.update_rows, 'update' as Filter],
    ['Reclassificações', summary.reclassify_rows, 'reclassify_partial' as Filter],
    ['Ignoradas', summary.ignored_rows, 'ignore' as Filter],
    ['Inválidas', summary.error_rows, 'error' as Filter],
  ] : [];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" /> Voltar ao painel
            </Link>
            <h1 className="text-3xl font-black">Importação parcial</h1>
            <p className="mt-2 text-sm text-slate-500">Valide a planilha, isole rejeições e confirme somente as linhas válidas.</p>
          </div>
          <div className="hidden rounded-2xl bg-emerald-50 p-3 text-emerald-700 sm:block"><FileSpreadsheet className="h-7 w-7" /></div>
        </div>

        {!preview && (
          <form action={submitPreview} className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
            <label className="space-y-2 text-sm font-bold">
              Instituição
              <select name="institutionId" required className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-medium">
                <option value="">Selecione</option>
                {institutions.map((item) => <option key={item.id} value={item.id}>{item.short_name || item.name}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-bold">
              Data de vigência
              <input name="effectiveDate" type="date" defaultValue={today} required className="w-full rounded-xl border border-slate-300 px-3 py-3 font-medium" />
            </label>
            <label className="space-y-2 text-sm font-bold">
              Tipo da relação
              <select name="importMode" defaultValue="general" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-medium">
                <option value="general">Atualização geral</option>
                <option value="integral_snapshot">Relação oficial de integrais</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-bold">
              Arquivo XLSX ou CSV
              <input name="file" type="file" accept=".xlsx,.csv" required className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm md:col-span-2">
              <input name="isOfficialSnapshot" value="true" type="checkbox" className="mt-1 h-4 w-4" />
              <span><strong>Lista oficial de integrais.</strong> Marque somente no modo correspondente; alunos integrais ausentes poderão ser reclassificados como parciais na data de vigência.</span>
            </label>
            <button disabled={isPending || institutions.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50 md:col-span-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Gerar preview seguro
            </button>
          </form>
        )}

        {message && (
          <div className={`rounded-2xl border p-4 text-sm font-bold ${message.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {message.text}
          </div>
        )}

        {preview && summary && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
              {cards.map(([label, value, target]) => (
                <button key={label as string} onClick={() => setFilter(target as Filter)} className={`rounded-2xl border bg-white p-4 text-left shadow-sm ${filter === target ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-200'}`}>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-black">{value}</p>
                </button>
              ))}
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
                <div>
                  <h2 className="font-black">Preview — {preview.original_filename}</h2>
                  <p className="text-xs text-slate-500">Exibindo até 250 linhas · vigência {new Date(`${preview.effective_date}T12:00:00`).toLocaleDateString('pt-BR')}</p>
                </div>
                {summary.error_rows > 0 && <div className="flex gap-2">
                  <a href={`/admin/importacoes/${preview.import_id}/rejeicoes?format=xlsx`} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black"><Download className="h-4 w-4" /> XLSX</a>
                  <a href={`/admin/importacoes/${preview.import_id}/rejeicoes?format=csv`} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black"><Download className="h-4 w-4" /> CSV</a>
                </div>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Linha</th><th className="p-3">Matrícula</th><th className="p-3">Nome</th><th className="p-3">Ação</th><th className="p-3">Diagnóstico</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRows.map((row) => <tr key={row.row_number} className={row.action === 'error' ? 'bg-red-50/50' : ''}>
                      <td className="p-3 font-mono text-xs">{row.row_number}</td>
                      <td className="p-3 font-bold">{row.registration_number || '—'}</td>
                      <td className="p-3">{row.full_name || '—'}</td>
                      <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{actionLabels[row.action]}</span></td>
                      <td className="max-w-md p-3 text-xs text-slate-600">{[...row.errors, ...row.warnings].join(' · ') || 'Sem ocorrências'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <label className="text-sm leading-6">
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mr-2 h-4 w-4" />
                  Confirmo o processamento de <strong>{summary.valid_rows} linhas válidas</strong>. As {summary.error_rows} inválidas serão rejeitadas, e saldos/extratos de carteira não serão alterados.
                </label>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button onClick={cancelImport} disabled={isPending || completed} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-black disabled:opacity-50"><XCircle className="h-4 w-4" /> Cancelar lote</button>
                <button onClick={confirmImport} disabled={!confirmed || isPending || completed || summary.valid_rows === 0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white disabled:opacity-50">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar linhas válidas
                </button>
              </div>
            </section>
          </>
        )}

        {!preview && recentImports.length > 0 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-black">Importações recentes</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {recentImports.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div><p className="font-bold">{item.original_filename}</p><p className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString('pt-BR')} · {item.total_rows} linhas</p></div>
                  <div className="flex items-center gap-3">
                    {item.error_rows > 0 && <a href={`/admin/importacoes/${item.id}/rejeicoes?format=xlsx`} className="font-bold text-red-700 hover:underline">Baixar {item.error_rows} rejeições</a>}
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
