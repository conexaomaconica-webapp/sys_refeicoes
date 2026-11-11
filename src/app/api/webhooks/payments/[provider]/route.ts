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

    if (provider === 'mock' && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { success: false, error: 'Provedor indisponível neste ambiente' },
        { status: 404 }
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

    const tenantId = request.nextUrl.searchParams.get('tenant_id') || undefined;
    const requestedEnvironment = request.nextUrl.searchParams.get('environment');
    const environment = requestedEnvironment === 'sandbox' || requestedEnvironment === 'production'
      ? requestedEnvironment
      : undefined;
    if (provider === 'asaas' && (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId) || !environment)) {
      return NextResponse.json(
        { success: false, error: 'Destino de webhook inválido' },
        { status: 400 }
      );
    }

    const result = await processWebhookServer(
      provider as PaymentProviderCode,
      request.headers,
      rawBody,
      payload,
      {
        dataId:
          request.nextUrl.searchParams.get('data.id') ||
          request.nextUrl.searchParams.get('data_id') ||
          undefined,
        tenantId,
        environment,
      }
    );

    if (!result.success) {
      // Falha de validação ou assinatura
      return NextResponse.json(result, { status: 401 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[Webhook Error]', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno no processamento do webhook',
      },
      { status: 500 }
    );
  }
}
