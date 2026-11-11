import { NextResponse } from 'next/server';

/**
 * Mapeia erros de autorização/validação de rotas de exportação para códigos HTTP semânticos
 * e registra trilha de auditoria sem expor dados financeiros sensíveis.
 */
export function mapExportErrorToResponse(err: unknown, contextLabel: string): NextResponse {
  const message = err instanceof Error ? err.message : 'Erro ao gerar relatório';

  let status = 500;
  if (message.includes('AUTH_REQUIRED') || message.includes('ACTIVE_PROFILE_REQUIRED')) {
    status = 401;
  } else if (
    message.includes('PERMISSION_DENIED') ||
    message.includes('ACCESS_DENIED') ||
    message.includes('TENANT_MISMATCH')
  ) {
    status = 403;
  } else if (
    message.includes('UNIT_SCOPE_REQUIRED') ||
    message.includes('INVALID_DATE_RANGE')
  ) {
    status = 400;
  }

  console.warn(`[ExportDenied:${contextLabel}]`, { status, reason: message.split(':')[0] });

  return NextResponse.json({ error: message }, { status });
}

/**
 * Registra trilha auditável não-sensível de exportação bem-sucedida.
 */
export function logExportAuditTrail(params: {
  reportType: 'financial_consolidated' | 'reconciliation_audit';
  userId: string;
  startDate: string;
  endDate: string;
  unitId?: string;
}): void {
  console.info('[ExportAudit]', {
    reportType: params.reportType,
    userId: params.userId,
    startDate: params.startDate,
    endDate: params.endDate,
    unitScope: params.unitId ? 'unit_filtered' : 'tenant_wide',
    exportedAt: new Date().toISOString(),
  });
}

