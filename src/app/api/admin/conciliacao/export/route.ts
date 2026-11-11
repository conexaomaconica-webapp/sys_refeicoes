import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  logExportAuditTrail,
  mapExportErrorToResponse,
} from '@/lib/security/export-route-error';
import {
  generateReconciliationExcelWorkbook,
  getReconciliationDashboard,
} from '@/server/reconciliation/reconciliation.server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0];
  const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];

  try {
    const data = await getReconciliationDashboard({ startDate, endDate });
    const buffer = generateReconciliationExcelWorkbook({
      kpis: data.kpis,
      latestBatch: data.latestBatch,
      divergences: data.divergences,
      dailyClosings: data.dailyClosings,
      period: { startDate, endDate },
    });

    logExportAuditTrail({
      reportType: 'reconciliation_audit',
      userId: user.id,
      startDate,
      endDate,
    });

    const safeStart = startDate.replace(/[^0-9-]/g, '');
    const safeEnd = endDate.replace(/[^0-9-]/g, '');
    const filename = `conciliacao-financeira-MA-${safeStart}-a-${safeEnd}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return mapExportErrorToResponse(err, 'reconciliation_audit');
  }
}
