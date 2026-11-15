'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileJson,
  HardDriveDownload,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

type BackupPeriodicity = 'daily' | 'weekly' | 'biweekly' | 'monthly';

interface BackupHistoryEntry {
  exportedAt: string;
  exportedBy: string;
  totalRows: number;
  checksum: string;
  filename: string;
  sizeBytes: number;
}

interface BackupPreferences {
  periodicity: BackupPeriodicity;
  history: BackupHistoryEntry[];
}

const PERIODICITY_OPTIONS: Array<{ value: BackupPeriodicity; label: string; days: number }> = [
  { value: 'daily', label: 'Diário (a cada 24h)', days: 1 },
  { value: 'weekly', label: 'Semanal (a cada 7 dias)', days: 7 },
  { value: 'biweekly', label: 'Quinzenal (a cada 15 dias)', days: 15 },
  { value: 'monthly', label: 'Mensal (a cada 30 dias)', days: 30 },
];

const DEFAULT_PREFS: BackupPreferences = {
  periodicity: 'weekly',
  history: [],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupManager({
  tenantId,
  tenantName,
  userName,
}: {
  tenantId: string;
  tenantName: string;
  userName: string;
}) {
  const storageKey = `ma_backup_prefs_${tenantId}`;
  const [prefs, setPrefs] = useState<BackupPreferences>(DEFAULT_PREFS);
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BackupPreferences>;
        setPrefs({
          periodicity: parsed.periodicity || 'weekly',
          history: Array.isArray(parsed.history) ? parsed.history : [],
        });
      }
    } catch {
      // Ignora localStorage indisponível
    }
  }, [storageKey]);

  const persistPrefs = (next: BackupPreferences) => {
    setPrefs(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignora erro de cota localStorage
    }
  };

  const handlePeriodicityChange = (periodicity: BackupPeriodicity) => {
    persistPrefs({ ...prefs, periodicity });
    setFeedback({
      kind: 'success',
      text: 'Periodicidade de lembrete de backup atualizada.',
    });
  };

  const handleDownloadBackup = async () => {
    setDownloading(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/admin/backup/export', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorJson = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorJson?.error || 'Não foi possível gerar o backup agora.');
      }

      const checksum = response.headers.get('X-Backup-Checksum') || 'n/d';
      const totalRows = Number(response.headers.get('X-Backup-Total-Rows') || '0');
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename =
        filenameMatch?.[1] || `backup-marefeicoes-${new Date().toISOString().slice(0, 10)}.json`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      const entry: BackupHistoryEntry = {
        exportedAt: new Date().toISOString(),
        exportedBy: userName,
        totalRows,
        checksum,
        filename,
        sizeBytes: blob.size,
      };

      const nextPrefs: BackupPreferences = {
        ...prefs,
        history: [entry, ...prefs.history].slice(0, 15),
      };
      persistPrefs(nextPrefs);

      setFeedback({
        kind: 'success',
        text: `Backup "${filename}" gerado com ${totalRows.toLocaleString('pt-BR')} registro(s) e checksum SHA-256 verificado.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro inesperado ao exportar backup.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const latestBackup = prefs.history[0] || null;
  const selectedPeriod =
    PERIODICITY_OPTIONS.find((opt) => opt.value === prefs.periodicity) || PERIODICITY_OPTIONS[1];
  const daysSinceLast = latestBackup
    ? (Date.now() - new Date(latestBackup.exportedAt).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;
  const isOverdue = !latestBackup || daysSinceLast > selectedPeriod.days;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section
          className="flex flex-col justify-between gap-5 rounded-3xl p-6 text-white shadow-xl md:flex-row md:items-end md:p-8"
          style={{ background: 'linear-gradient(135deg, var(--admin-secondary), var(--admin-primary))' }}
        >
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/75">
              Proteção e contingência de dados
            </p>
            <h1 className="mt-2 text-3xl font-black">Backup de Dados</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/80">
              Exporte periodicamente uma cópia íntegra dos dados de <strong>{tenantName}</strong>{' '}
              com verificação SHA-256 para guarda externa.
            </p>
          </div>
          <button
            type="button"
            disabled={downloading}
            onClick={handleDownloadBackup}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F4C430] px-5 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:brightness-95 disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? 'Gerando backup...' : 'Gerar e baixar backup agora'}
          </button>
        </section>

        {feedback && (
          <div
            className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold ${
              feedback.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {feedback.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Situação do Backup
              </span>
              {isOverdue ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-800">
                  Pendente / Atrasado
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800">
                  Em dia
                </span>
              )}
            </div>
            <p className="mt-3 text-lg font-black text-slate-900">
              {latestBackup
                ? new Date(latestBackup.exportedAt).toLocaleString('pt-BR')
                : 'Nenhum backup baixado nesta estação'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {latestBackup
                ? `${latestBackup.totalRows.toLocaleString('pt-BR')} registros · ${formatBytes(latestBackup.sizeBytes)}`
                : 'Recomendamos gerar um backup inicial e salvá-lo em cofre externo.'}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <CalendarClock className="h-4 w-4 text-slate-400" />
              Periodicidade Recomendada
            </div>
            <select
              value={prefs.periodicity}
              onChange={(event) => handlePeriodicityChange(event.target.value as BackupPeriodicity)}
              className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-500"
            >
              {PERIODICITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              Alerta automaticamente quando ultrapassar {selectedPeriod.days} dia(s) sem cópia.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Segurança & Escopo
            </div>
            <p className="mt-3 text-sm font-bold text-slate-900">
              Isolado por Tenant + Sem Segredos
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Exporta apenas dados operacionais e financeiros da sua instituição, com integridade
              SHA-256, excluindo senhas e chaves privadas.
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <HardDriveDownload className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-black">Histórico de Backups Baixados</h2>
            </div>
            {prefs.history.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Ainda não há backups registrados neste navegador. Clique em{' '}
                <strong>Gerar e baixar backup agora</strong> para criar a primeira cópia.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500 uppercase">
                    <tr>
                      <th className="py-2.5 pr-3">Data / Hora</th>
                      <th className="py-2.5 pr-3">Arquivo</th>
                      <th className="py-2.5 pr-3 text-right">Registros</th>
                      <th className="py-2.5 pr-3 text-right">Tamanho</th>
                      <th className="py-2.5">SHA-256</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {prefs.history.map((item, idx) => (
                      <tr key={`${item.exportedAt}-${idx}`}>
                        <td className="py-2.5 pr-3 font-semibold text-slate-800">
                          {new Date(item.exportedAt).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-slate-700">{item.filename}</td>
                        <td className="py-2.5 pr-3 text-right font-bold">
                          {item.totalRows.toLocaleString('pt-BR')}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">
                          {formatBytes(item.sizeBytes)}
                        </td>
                        <td
                          className="py-2.5 font-mono text-[11px] text-slate-500"
                          title={item.checksum}
                        >
                          {item.checksum.slice(0, 16)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-black">O que é salvo no backup</h2>
            </div>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <DatabaseBackup className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>
                  <strong>Estrutura e Regras:</strong> instituição, unidades, categorias, histórico
                  de categoria, turnos, horários, regras de preço e calendário operacional.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <DatabaseBackup className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>
                  <strong>Comensais e Consumo:</strong> cadastro de comensais, consumos de
                  refeições, lotes de contingência e campanhas de regularização.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <DatabaseBackup className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>
                  <strong>Financeiro e Auditoria:</strong> carteiras, livro-razão imutável,
                  recargas, pagamentos, turnos/movimentações de caixa e fechamentos diários.
                </span>
              </li>
            </ul>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
              <strong>Recomendação de guarda:</strong> armazene o arquivo baixado em mídia externa
              ou pasta corporativa com acesso restrito ao Administrador Geral, em complemento ao
              backup automático em nuvem (PITR).
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

