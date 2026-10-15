import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { PaymentProviderFactory } from '@/server/payments/provider.factory';
import type { Json } from '@/types/database.types';
import type { InitiateRechargeInput, PaymentProviderCode } from '@/types/payment';

/**
 * ==============================================================================
 * Serviço de Recarga Financeira e Processamento de Pagamentos (Server-Side)
 * ==============================================================================
 */

/**
 * Inicia uma recarga gerando cobrança no gateway (Pix ou Cartão) e registrando a ordem pendente.
 */
export async function initiateRechargeServer(input: InitiateRechargeInput): Promise<{
  success: boolean;
  paymentId?: string;
  rechargeId?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  status?: string;
  error?: string;
}> {
  // 1. Validar autenticação do usuário na sessão
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Acesso negado. Usuário não autenticado.' };
  }

  const { studentId, method, amount, providerCode, cardToken } = input;

  if (amount <= 0) {
    return { success: false, error: 'O valor da recarga deve ser maior que R$ 0.00' };
  }

  // REGRA DE SEGURANÇA: Bloquear provedor SiTef/Fiserv até homologação presencial
  if (providerCode === 'sitef') {
    return {
      success: false,
      error: 'UNAVAILABLE_PROVIDER: O provedor SiTef/Fiserv está reservado para homologação presencial e permanece indisponível para recargas online nesta versão.',
    };
  }

  const adminClient = getAdminClient();

  // 2. Buscar dados do aluno e validar categoria
  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('id, tenant_id, full_name, email, category_id, student_categories (code, requires_wallet)')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    return { success: false, error: 'Aluno não encontrado no sistema.' };
  }

  const category = (student.student_categories as unknown) as { code: string; requires_wallet: boolean } | null;
  
  // REGRA CRÍTICA: Bloquear alunos integrais (requires_wallet = false)
  if (category?.requires_wallet === false) {
    return {
      success: false,
      error: 'Alunos da categoria Bolsista Integral são isentos e não podem realizar recargas financeiras.',
    };
  }

  // 3. Obter o provedor de pagamento (Asaas, Mercado Pago ou Mock)
  const provider = await PaymentProviderFactory.getProviderForTenant(student.tenant_id, providerCode);

  let externalPaymentId = '';
  let pixQrCode: string | undefined;
  let pixCopyPaste: string | undefined;
  let initialGatewayStatus: 'pending' | 'confirmed' = 'pending';
  let rawResponse: unknown;

  try {
    if (method === 'pix') {
      const pixResult = await provider.createPixCharge({
        amount,
        description: `Recarga de Carteira - Aluno: ${student.full_name}`,
        studentName: student.full_name,
        studentEmail: student.email || undefined,
      });

      externalPaymentId = pixResult.externalId;
      pixQrCode = pixResult.qrCodeBase64;
      pixCopyPaste = pixResult.copyPasteKey;
      rawResponse = pixResult.rawResponse;
    } else if (method === 'credit_card') {
      const cardResult = await provider.createCardCharge({
        amount,
        token: cardToken,
        description: `Recarga Cartão - Aluno: ${student.full_name}`,
      });

      externalPaymentId = cardResult.externalId;
      initialGatewayStatus = cardResult.status === 'confirmed' ? 'confirmed' : 'pending';
      rawResponse = cardResult.rawResponse;
    }
  } catch (err) {
    return { success: false, error: `Falha na comunicação com gateway de pagamento: ${(err as Error).message}` };
  }

  // 4. Invocar RPC para criar a ordem no banco de dados de forma atômica
  const { data: orderData, error: orderError } = await adminClient.rpc('create_payment_order', {
    p_requesting_user_id: user.id,
    p_student_id: studentId,
    p_method: method,
    p_amount: amount,
    p_provider_code: provider.code,
    p_external_payment_id: externalPaymentId,
    p_pix_qr_code: pixQrCode,
    p_pix_copy_paste: pixCopyPaste,
    p_raw_response: (rawResponse as unknown as Json) ?? null,
  });

  if (orderError || !orderData) {
    return { success: false, error: `Erro ao registrar pedido de recarga: ${orderError?.message}` };
  }

  const order = orderData as { payment_id: string; recharge_id: string };

  // 5. Se o cartão já foi aprovado instantaneamente pelo gateway, confirmar e creditar o ledger imediatamente!
  if (initialGatewayStatus === 'confirmed') {
    await adminClient.rpc('confirm_payment_recharge', {
      p_external_payment_id: externalPaymentId,
      p_provider_code: provider.code,
      p_event_id: `instant_card_${Date.now()}`,
      p_payload: ((rawResponse || {}) as unknown as Json),
    });
  }

  return {
    success: true,
    paymentId: order.payment_id,
    rechargeId: order.recharge_id,
    pixQrCode,
    pixCopyPaste,
    status: initialGatewayStatus,
  };
}

/**
 * Processa um webhook recebido de um gateway de pagamento de forma autenticada e idempotente.
 */
export async function processWebhookServer(
  providerCode: PaymentProviderCode,
  headers: Headers,
  rawBody: string,
  payload: unknown
): Promise<{ success: boolean; message: string }> {
  const provider = PaymentProviderFactory.createProvider(providerCode);

  // 1. Validar autenticidade / assinatura do webhook
  const isAuthentic = await provider.verifyWebhookSignature(headers, rawBody);
  if (!isAuthentic) {
    return { success: false, message: 'Assinatura inválida no webhook.' };
  }

  // 2. Extrair dados padronizados do evento
  const event = provider.parseWebhook(payload);
  if (!event.isValid || !event.isConfirmed) {
    return { success: true, message: `Evento ${event.eventType} ignorado (não é confirmação de pagamento).` };
  }

  // 3. Invocar a RPC atômica confirm_payment_recharge no banco
  const adminClient = getAdminClient();
  const { data: result, error } = await adminClient.rpc('confirm_payment_recharge', {
    p_external_payment_id: event.externalPaymentId,
    p_provider_code: providerCode,
    p_event_id: event.eventId,
    p_payload: ((event.rawPayload || {}) as unknown as Json),
  });

  if (error) {
    return { success: false, message: `Erro ao creditar recarga no ledger: ${error.message}` };
  }

  const res = result as { success: boolean; already_confirmed?: boolean; already_processed?: boolean };
  if (res.already_confirmed || res.already_processed) {
    return { success: true, message: 'Evento já havia sido processado anteriormente (Idempotente).' };
  }

  return { success: true, message: 'Pagamento confirmado e saldo creditado automaticamente com sucesso!' };
}

/**
 * Reconcilia manualmente um pagamento pendente consultando o status na API do gateway.
 */
export async function reconcilePaymentServer(paymentId: string): Promise<{ success: boolean; status?: string; error?: string }> {
  const adminClient = getAdminClient();

  const { data: payment, error } = await adminClient
    .from('payments')
    .select('*, payment_providers(code)')
    .eq('id', paymentId)
    .single();

  if (error || !payment) {
    return { success: false, error: 'Pagamento não encontrado.' };
  }

  if (payment.status === 'confirmed') {
    return { success: true, status: 'confirmed' };
  }

  const providerRelation = payment.payment_providers as { code?: PaymentProviderCode } | { code?: PaymentProviderCode }[] | null;
  const providerCode = (Array.isArray(providerRelation) ? providerRelation[0]?.code : providerRelation?.code) || 'mock';
  const provider = await PaymentProviderFactory.getProviderForTenant(payment.tenant_id, providerCode);

  const extPaymentId = payment.external_payment_id;
  if (!extPaymentId) {
    return { success: false, error: 'Pagamento sem ID externo registrado.' };
  }

  const statusInfo = await provider.getPaymentStatus(extPaymentId);
  if (statusInfo.status === 'confirmed') {
    await adminClient.rpc('confirm_payment_recharge', {
      p_external_payment_id: extPaymentId,
      p_provider_code: providerCode,
      p_event_id: `reconcile_${Date.now()}`,
      p_payload: { reconciled: true } as unknown as Json,
    });
    return { success: true, status: 'confirmed' };
  }

  return { success: true, status: statusInfo.status };
}
