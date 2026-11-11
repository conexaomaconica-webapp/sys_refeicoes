'use server';

import { revalidatePath } from 'next/cache';
import {
  saveAsaasIntegrationServer,
  testAsaasApiServer,
  testAsaasWebhookServer,
  type PaymentEnvironment,
} from '@/services/admin-payment-integration.service';

type Result = { success: true; message: string } | { success: false; error: string };

export async function saveAsaasIntegrationAction(input: {
  environment: PaymentEnvironment;
  apiKey?: string;
  webhookSecret?: string;
  isActive: boolean;
}): Promise<Result> {
  try {
    await saveAsaasIntegrationServer(input);
    revalidatePath('/admin/integracoes');
    return { success: true, message: 'Configuração armazenada de forma cifrada no Supabase Vault.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Não foi possível salvar a integração.' };
  }
}

export async function testAsaasApiAction(environment: PaymentEnvironment): Promise<Result> {
  try {
    const message = await testAsaasApiServer(environment);
    revalidatePath('/admin/integracoes');
    return { success: true, message };
  } catch (error) {
    revalidatePath('/admin/integracoes');
    return { success: false, error: error instanceof Error ? error.message : 'Teste da API falhou.' };
  }
}

export async function testAsaasWebhookAction(environment: PaymentEnvironment): Promise<Result> {
  try {
    const message = await testAsaasWebhookServer(environment);
    revalidatePath('/admin/integracoes');
    return { success: true, message };
  } catch (error) {
    revalidatePath('/admin/integracoes');
    return { success: false, error: error instanceof Error ? error.message : 'Teste do webhook falhou.' };
  }
}

