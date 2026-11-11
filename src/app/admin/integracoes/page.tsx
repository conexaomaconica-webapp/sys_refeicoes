import { listAsaasIntegrationsServer } from '@/services/admin-payment-integration.service';
import { AsaasIntegrationManager } from './AsaasIntegrationManager';

export default async function IntegrationsPage() {
  try {
    const data = await listAsaasIntegrationsServer();
    return <AsaasIntegrationManager {...data} productionActivationAllowed={process.env.PAYMENT_PRODUCTION_ENABLE_ALLOWED === 'true'} />;
  } catch (error) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
          <h1 className="text-xl font-black">Integrações financeiras</h1>
          <p className="mt-2 text-sm">{error instanceof Error ? error.message : 'Não foi possível carregar as integrações.'}</p>
          <p className="mt-3 text-xs">A migration 76 precisa estar aplicada antes de utilizar esta área.</p>
        </div>
      </main>
    );
  }
}

