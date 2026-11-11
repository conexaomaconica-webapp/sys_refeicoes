'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FlaskConical, KeyRound, Loader2, PlugZap, ShieldAlert, Webhook } from 'lucide-react';
import type { AsaasIntegrationSummary, PaymentEnvironment } from '@/services/admin-payment-integration.service';
import { saveAsaasIntegrationAction, testAsaasApiAction, testAsaasWebhookAction } from './actions';

interface Props {
  tenantId: string;
  integrations: AsaasIntegrationSummary[];
  productionActivationAllowed: boolean;
}

const emptyStatus = (environment: PaymentEnvironment): AsaasIntegrationSummary => ({
  environment, isActive: false, hasApiKey: false, hasWebhookSecret: false,
  lastApiTestStatus: 'not_tested', lastApiTestAt: null,
  lastWebhookTestStatus: 'not_tested', lastWebhookTestAt: null,
  lastTestMessage: null, updatedAt: '',
});

export function AsaasIntegrationManager({ tenantId, integrations, productionActivationAllowed }: Props) {
  const router = useRouter();
  const [environment, setEnvironment] = useState<PaymentEnvironment>('sandbox');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [origin, setOrigin] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const current = useMemo(() => integrations.find((item) => item.environment === environment) || emptyStatus(environment), [environment, integrations]);
  const webhookPath = `/api/webhooks/payments/asaas?tenant_id=${tenantId}&environment=${environment}`;
  const webhookUrl = `${origin}${webhookPath}`;

  useEffect(() => setOrigin(window.location.origin), []);

  const changeEnvironment = (next: PaymentEnvironment) => {
    setEnvironment(next); setApiKey(''); setWebhookSecret('');
    setIsActive(integrations.find((item) => item.environment === next)?.isActive || false); setMessage(null);
  };

  const run = (task: () => Promise<{ success: true; message: string } | { success: false; error: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await task();
      setMessage(result.success ? { kind: 'success', text: result.message } : { kind: 'error', text: result.error });
      router.refresh();
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    run(() => saveAsaasIntegrationAction({ environment, apiKey: apiKey || undefined, webhookSecret: webhookSecret || undefined, isActive }));
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <section
        className="overflow-hidden rounded-3xl p-6 text-white shadow-xl md:p-8"
        style={{ background: 'linear-gradient(135deg, var(--admin-secondary), var(--admin-primary))' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/75">
              Configuração Master
            </p>
            <h1 className="mt-2 text-3xl font-black">Integrações e APIs (Asaas)</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/80">
              Configure credenciais, valide a API e confira a autenticação do webhook sem revelar os segredos novamente.
            </p>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
            <PlugZap className="h-6 w-6" />
          </div>
        </div>
      </section>

      <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {(['sandbox', 'production'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => changeEnvironment(item)}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-black transition ${
              environment === item ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
            style={environment === item ? { backgroundColor: 'var(--admin-primary)' } : undefined}
          >
            {item === 'sandbox' ? 'Sandbox (Homologação)' : 'Produção'}
          </button>
        ))}
      </div>

      {environment === 'production' && !productionActivationAllowed && (
        <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <strong>Produção em NO-GO.</strong>
            <p className="mt-1">
              É permitido salvar e executar o teste de autenticação somente leitura. A ativação operacional permanece bloqueada.
            </p>
          </div>
        </div>
      )}
      {message && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
            message.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <form onSubmit={save} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black text-slate-900">
              <KeyRound className="h-5 w-5" style={{ color: 'var(--admin-primary)' }} />
              Credenciais de {environment === 'sandbox' ? 'Sandbox' : 'Produção'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Campos vazios preservam os segredos já armazenados.</p>
          </div>
          <label className="block text-sm font-bold">
            Chave da API
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                current.hasApiKey
                  ? '•••••••• chave já configurada'
                  : environment === 'sandbox'
                  ? '$aact_hmlg_...'
                  : '$aact_prod_...'
              }
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-mono text-sm outline-none focus:border-[var(--admin-primary)]"
            />
          </label>
          <label className="block text-sm font-bold">
            Token de autenticação do webhook
            <input
              type="password"
              autoComplete="new-password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              minLength={32}
              placeholder={current.hasWebhookSecret ? '•••••••• segredo já configurado' : 'Mínimo de 32 caracteres'}
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-mono text-sm outline-none focus:border-[var(--admin-primary)]"
            />
          </label>
          <label className="block text-sm font-bold">
            URL do webhook
            <div className="mt-1.5 break-all rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-xs text-slate-600">
              {webhookUrl}
            </div>
          </label>
          <label
            className={`flex items-center justify-between gap-4 rounded-2xl border p-4 text-sm font-bold ${
              environment === 'production' && !productionActivationAllowed
                ? 'border-slate-200 bg-slate-100 text-slate-400'
                : 'border-slate-200 bg-slate-50 text-slate-900'
            }`}
          >
            Usar este ambiente nas operações
            <input
              type="checkbox"
              checked={isActive}
              disabled={environment === 'production' && !productionActivationAllowed}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-5 w-5"
              style={{ accentColor: 'var(--admin-primary)' }}
            />
          </label>
          <button
            disabled={pending || (!apiKey && !webhookSecret && !current.hasApiKey)}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-black text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
            style={{ backgroundColor: 'var(--admin-primary)' }}
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Salvar configuração
          </button>
        </form>

        <aside className="space-y-4">
          <StatusCard title="API" status={current.lastApiTestStatus} at={current.lastApiTestAt} icon={FlaskConical} />
          <StatusCard title="Webhook" status={current.lastWebhookTestStatus} at={current.lastWebhookTestAt} icon={Webhook} />
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-black text-slate-900">Testes seguros</h2>
            <p className="text-xs text-slate-500">
              O teste da API consulta apenas a situação cadastral. Nenhuma cobrança é criada. O teste do webhook usa vetores locais positivo e negativo.
            </p>
            <button
              type="button"
              disabled={pending || !current.hasApiKey}
              onClick={() => run(() => testAsaasApiAction(environment))}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-black transition hover:border-[var(--admin-primary)] disabled:opacity-40"
            >
              <FlaskConical className="h-4 w-4" /> Testar API
            </button>
            <button
              type="button"
              disabled={pending || !current.hasWebhookSecret}
              onClick={() => run(() => testAsaasWebhookAction(environment))}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-black transition hover:border-[var(--admin-primary)] disabled:opacity-40"
            >
              <Webhook className="h-4 w-4" /> Testar assinatura do webhook
            </button>
            {current.lastTestMessage && (
              <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{current.lastTestMessage}</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function StatusCard({ title, status, at, icon: Icon }: { title: string; status: AsaasIntegrationSummary['lastApiTestStatus']; at: string | null; icon: typeof FlaskConical }) {
  const colors = status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : status === 'failed' ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-white text-slate-700';
  return <div className={`flex items-center gap-4 rounded-2xl border p-4 shadow-sm ${colors}`}><Icon className="h-6 w-6" /><div><p className="text-xs font-bold uppercase tracking-wider">{title}</p><p className="font-black">{status === 'success' ? 'Aprovado' : status === 'failed' ? 'Reprovado' : 'Não testado'}</p>{at && <p className="text-xs opacity-70">{new Date(at).toLocaleString('pt-BR')}</p>}</div></div>;
}
