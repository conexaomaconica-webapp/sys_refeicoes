import { NextRequest, NextResponse } from 'next/server';
import { processWebhookServer } from '@/services/recharge.service';
import { PaymentProviderCode } from '@/types/payment';

interface RouteParams {
  params: Promise<{ provider: string }>;
}

export async function POST(request: NextRequest, context: RouteParams) {
  try {
    const { provider } = await context.params;

    if (!['asaas', 'mercadopago', 'mock'].includes(provider)) {
      return NextResponse.json(
        { success: false, error: `Provedor inválido: ${provider}` },
        { status: 400 }
      );
    }

    const rawBody = await request.text();
    let payload: unknown = {};
    if (rawBody && rawBody.trim().length > 0) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = {};
      }
    }

    const result = await processWebhookServer(
      provider as PaymentProviderCode,
      request.headers,
      rawBody,
      payload
    );

    if (!result.success) {
      // Falha de validação ou assinatura
      return NextResponse.json(result, { status: 401 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[Webhook Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Erro interno no processamento do webhook',
      },
      { status: 500 }
    );
  }
}
