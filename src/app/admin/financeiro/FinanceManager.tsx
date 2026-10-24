'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  History,
  RefreshCw,
  Search,
  Undo2,
  WalletCards,
  X,
} from 'lucide-react';
import type {
  FinanceDashboardData,
  FinancePaymentItem,
  FinanceTransactionItem,
  FinanceWalletItem,
} from '@/services/admin-finance.service';
import {
  createManualAdjustmentAction,
  reconcileFinancePaymentAction,
  reverseFinanceTransactionAction,
} from './actions';

type Tab = 'wallets' | 'transactions' | 'payments' | 'recharges';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const transactionLabels = {
  recharge: 'Recarga',
  meal_debit: 'Consumo',
  refund: 'Devolução',
  reversal: 'Estorno',
  manual_adjustment: 'Ajuste manual',
};

const paymentStatusLabels = {
  pending: 'Pendente', confirmed: 'Confirmado', failed: 'Falhou', cancelled: 'Cancelado', refunded: 'Estornado',
};

const rechargeStatusLabels = {
  pending: 'Pendente', confirmed: 'Confirmada', failed: 'Falhou', reversed: 'Estornada',
};

export function FinanceManager({ wallets, transactions, payments, recharges, canManage, summary }: FinanceDashboardData) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>('wallets');
  const [search, setSearch] = useState('');
  const [adjustmentWallet, setAdjustmentWallet] = useState<FinanceWalletItem | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<'credit' | 'debit'>('credit');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [reversal, setReversal] = useState<FinanceTransactionItem | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const visibleWallets = useMemo(() => wallets.filter((item) => !normalizedSearch ||
    item.studentName.toLocaleLowerCase('pt-BR').includes(normalizedSearch) ||
    item.registrationNumber.toLocaleLowerCase('pt-BR').includes(normalizedSearch) ||
    item.institutionName.toLocaleLowerCase('pt-BR').includes(normalizedSearch)), [normalizedSearch, wallets]);
  const visibleTransactions = useMemo(() => transactions.filter((item) => !normalizedSearch ||
    item.studentName.toLocaleLowerCase('pt-BR').includes(normalizedSearch) ||
    item.description.toLocaleLowerCase('pt-BR').includes(normalizedSearch)), [normalizedSearch, transactions]);
  const visiblePayments = useMemo(() => payments.filter((item) => !normalizedSearch ||
    item.studentName.toLocaleLowerCase('pt-BR').includes(normalizedSearch) ||
    item.providerName.toLocaleLowerCase('pt-BR').includes(normalizedSearch)), [normalizedSearch, payments]);
  const visibleRecharges = useMemo(() => recharges.filter((item) => !normalizedSearch ||
    item.studentName.toLocaleLowerCase('pt-BR').includes(normalizedSearch)), [normalizedSearch, recharges]);

  const closeAdjustment = () => {
    setAdjustmentWallet(null);
    setAdjustmentAmount('');
    setAdjustmentReason('');
  };

  const submitAdjustment = (event: React.FormEvent) => {
    event.preventDefault();
    if (!adjustmentWallet) return;
    const parsedAmount = Number(adjustmentAmount.replace(',', '.'));
    setMessage(null);
    startTransition(async () => {
      const result = await createManualAdjustmentAction({
        studentId: adjustmentWallet.studentId,
        amount: adjustmentType === 'debit' ? -Math.abs(parsedAmount) : Math.abs(parsedAmount),
        description: adjustmentReason,
      });
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      closeAdjustment();
      setMessage({ kind: 'success', text: result.message });
      router.refresh();
    });
  };

  const submitReversal = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reversal) return;
    setMessage(null);
    startTransition(async () => {
      const result = await reverseFinanceTransactionAction({ transactionId: reversal.id, reason: reversalReason });
      if (!result.success) return setMessage({ kind: 'error', text: result.error });
      setReversal(null);
      setReversalReason('');
      setMessage({ kind: 'success', text: result.message });
      router.refresh();
    });
  };

  const reconcile = (payment: FinancePaymentItem) => {
    setMessage(null);
    startTransition(async () => {
      const result = await reconcileFinancePaymentAction(payment.id);
      setMessage(result.success ? { kind: 'success', text: result.message } : { kind: 'error', text: result.error });
      if (result.success) router.refresh();
    });
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'wallets', label: `Carteiras (${wallets.length})` },
    { id: 'transactions', label: `Movimentações (${transactions.length})` },
    { id: 'payments', label: `Pagamentos (${payments.length})` },
    { id: 'recharges', label: `Recargas (${recharges.length})` },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <section className="rounded-3xl p-6 text-white shadow-xl md:p-8" style={{ background: 'linear-gradient(135deg, var(--admin-secondary), var(--admin-primary))' }}>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Controle e conciliação</p>
        <h1 className="mt-2 text-3xl font-black">Financeiro</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/80">Acompanhe saldos, pagamentos, recargas e o livro-razão imutável das carteiras.</p>
      </section>

      {!canManage && <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">Seu perfil possui acesso financeiro somente para consulta.</div>}
      {message && <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${message.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={WalletCards} label="Saldo em carteiras" value={currency.format(summary.totalBalance)} color="text-blue-600" />
        <SummaryCard icon={Banknote} label="Recargas no mês" value={currency.format(summary.confirmedRechargesMonth)} color="text-emerald-600" />
        <SummaryCard icon={CreditCard} label="Pagamentos pendentes" value={String(summary.pendingPayments)} detail={currency.format(summary.pendingAmount)} color="text-amber-600" />
        <SummaryCard icon={History} label="Carteiras ativas" value={String(summary.activeWallets)} color="text-violet-600" />
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex gap-2 overflow-x-auto">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab === item.id ? 'text-white' : 'bg-slate-100 text-slate-600'}`} style={tab === item.id ? { backgroundColor: 'var(--admin-primary)' } : undefined}>{item.label}</button>)}</div>
            <label className="relative min-w-64"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar comensal ou referência" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm" /></label>
          </div>
        </div>

        <div className="overflow-x-auto p-4 md:p-5">
          {tab === 'wallets' && <WalletTable items={visibleWallets} canManage={canManage} onAdjust={setAdjustmentWallet} />}
          {tab === 'transactions' && <TransactionTable items={visibleTransactions} onReverse={setReversal} />}
          {tab === 'payments' && <PaymentTable items={visiblePayments} canManage={canManage} pending={isPending} onReconcile={reconcile} />}
          {tab === 'recharges' && <RechargeTable items={visibleRecharges} />}
        </div>
      </section>

      {adjustmentWallet && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/65 p-4"><form onSubmit={submitAdjustment} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><ModalHeader title="Ajuste de carteira" onClose={closeAdjustment} /><p className="mt-3 text-sm text-slate-500">{adjustmentWallet.studentName} · saldo {currency.format(adjustmentWallet.balance)}</p><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => setAdjustmentType('credit')} className={`rounded-xl border p-3 text-sm font-black ${adjustmentType === 'credit' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300'}`}><ArrowUpCircle className="mx-auto mb-1 h-5 w-5" /> Crédito</button><button type="button" onClick={() => setAdjustmentType('debit')} className={`rounded-xl border p-3 text-sm font-black ${adjustmentType === 'debit' ? 'border-red-500 bg-red-50 text-red-800' : 'border-slate-300'}`}><ArrowDownCircle className="mx-auto mb-1 h-5 w-5" /> Débito</button></div><label className="mt-4 block text-sm font-bold">Valor<input value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} inputMode="decimal" placeholder="0,00" required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label><label className="mt-4 block text-sm font-bold">Justificativa<textarea value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} minLength={5} required rows={3} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label><ModalActions pending={isPending} onCancel={closeAdjustment} label="Registrar ajuste" /></form></div>}
      {reversal && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/65 p-4"><form onSubmit={submitReversal} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><ModalHeader title="Estornar lançamento" onClose={() => setReversal(null)} /><p className="mt-3 text-sm text-slate-500">{reversal.studentName} · {transactionLabels[reversal.type]} · {currency.format(reversal.amount)}</p><div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">O histórico original não será apagado. Um lançamento compensatório será criado no livro-razão.</div><label className="mt-4 block text-sm font-bold">Motivo do estorno<textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} minLength={5} required rows={3} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label><ModalActions pending={isPending} onCancel={() => setReversal(null)} label="Confirmar estorno" /></form></div>}
    </main>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, color }: { icon: typeof WalletCards; label: string; value: string; detail?: string; color: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Icon className={`h-5 w-5 ${color}`} /><p className="mt-2 text-2xl font-black">{value}</p><p className="text-xs font-bold uppercase text-slate-500">{label}</p>{detail && <p className="mt-1 text-xs text-slate-400">{detail}</p>}</div>;
}

function WalletTable({ items, canManage, onAdjust }: { items: FinanceWalletItem[]; canManage: boolean; onAdjust: (item: FinanceWalletItem) => void }) {
  return <table className="w-full min-w-[800px] text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-3">Comensal</th><th className="p-3">Instituição</th><th className="p-3">Saldo</th><th className="p-3">Status</th><th className="p-3 text-right">Ação</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3"><p className="font-bold">{item.studentName}</p><p className="text-xs text-slate-500">{item.registrationNumber}</p></td><td className="p-3">{item.institutionName}</td><td className="p-3 font-black">{currency.format(item.balance)}</td><td className="p-3"><StatusBadge status={item.status} /></td><td className="p-3 text-right">{canManage && item.status === 'active' && <button type="button" onClick={() => onAdjust(item)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black">Ajustar</button>}</td></tr>)}</tbody></table>;
}

function TransactionTable({ items, onReverse }: { items: FinanceTransactionItem[]; onReverse: (item: FinanceTransactionItem) => void }) {
  return <table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-3">Data</th><th className="p-3">Comensal</th><th className="p-3">Tipo</th><th className="p-3">Descrição</th><th className="p-3">Valor</th><th className="p-3">Saldo</th><th className="p-3 text-right">Ação</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3 text-xs">{dateTime.format(new Date(item.createdAt))}</td><td className="p-3 font-bold">{item.studentName}</td><td className="p-3">{transactionLabels[item.type]}</td><td className="max-w-64 truncate p-3 text-slate-500" title={item.description}>{item.description}</td><td className={`p-3 font-black ${item.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{currency.format(item.amount)}</td><td className="p-3">{currency.format(item.balanceAfter)}</td><td className="p-3 text-right">{item.canReverse && <button type="button" onClick={() => onReverse(item)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-black"><Undo2 className="h-3.5 w-3.5" /> Estornar</button>}</td></tr>)}</tbody></table>;
}

function PaymentTable({ items, canManage, pending, onReconcile }: { items: FinancePaymentItem[]; canManage: boolean; pending: boolean; onReconcile: (item: FinancePaymentItem) => void }) {
  return <table className="w-full min-w-[800px] text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-3">Data</th><th className="p-3">Comensal</th><th className="p-3">Provedor</th><th className="p-3">Método</th><th className="p-3">Valor</th><th className="p-3">Status</th><th className="p-3 text-right">Ação</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3 text-xs">{dateTime.format(new Date(item.createdAt))}</td><td className="p-3 font-bold">{item.studentName}</td><td className="p-3">{item.providerName}</td><td className="p-3">{item.method === 'pix' ? 'Pix' : 'Cartão'}</td><td className="p-3 font-black">{currency.format(item.amount)}</td><td className="p-3"><StatusBadge status={paymentStatusLabels[item.status]} /></td><td className="p-3 text-right">{canManage && item.status === 'pending' && <button type="button" disabled={pending} onClick={() => onReconcile(item)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-black disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Conciliar</button>}</td></tr>)}</tbody></table>;
}

function RechargeTable({ items }: { items: FinanceDashboardData['recharges'] }) {
  return <table className="w-full min-w-[700px] text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="p-3">Data</th><th className="p-3">Comensal</th><th className="p-3">Origem</th><th className="p-3">Valor</th><th className="p-3">Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3 text-xs">{dateTime.format(new Date(item.createdAt))}</td><td className="p-3 font-bold">{item.studentName}</td><td className="p-3 uppercase">{item.source.replace('_', ' ')}</td><td className="p-3 font-black">{currency.format(item.amount)}</td><td className="p-3"><StatusBadge status={rechargeStatusLabels[item.status]} /></td></tr>)}</tbody></table>;
}

function StatusBadge({ status }: { status: string }) {
  const positive = ['active', 'Ativo', 'Confirmado', 'Confirmada'].includes(status);
  const pending = status === 'Pendente';
  const label = status === 'active' ? 'Ativa' : status === 'frozen' ? 'Congelada' : status === 'closed' ? 'Encerrada' : status;
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${positive ? 'bg-emerald-100 text-emerald-800' : pending ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'}`}>{label}</span>;
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Fechar"><X className="h-5 w-5" /></button></div>;
}

function ModalActions({ pending, onCancel, label }: { pending: boolean; onCancel: () => void; label: string }) {
  return <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Cancelar</button><button disabled={pending} className="rounded-xl px-4 py-3 text-sm font-black text-white disabled:opacity-50" style={{ backgroundColor: 'var(--admin-primary)' }}>{pending ? 'Processando...' : label}</button></div>;
}
