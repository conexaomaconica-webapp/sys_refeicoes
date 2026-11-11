import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  logExportAuditTrail,
  mapExportErrorToResponse,
} from '@/lib/security/export-route-error';
import {
  getConsolidatedFinancialReport,
  generateFinancialReportExcelWorkbook,
} from '@/server/reports/financial-reporting.server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0];
  const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];
  const institutionId = searchParams.get('institutionId') || undefined;
  const unitId = searchParams.get('unitId') || undefined;
  const categoryId = searchParams.get('categoryId') || undefined;

  try {
    const report = await getConsolidatedFinancialReport({
      startDate,
      endDate,
      institutionId,
      unitId,
      categoryId,
    });

    const buffer = generateFinancialReportExcelWorkbook(report);

    logExportAuditTrail({
      reportType: 'financial_consolidated',
      userId: user.id,
      startDate,
      endDate,
      unitId,
    });

    const safeStart = startDate.replace(/[^0-9-]/g, '');
    const safeEnd = endDate.replace(/[^0-9-]/g, '');
    const filename = `relatorio-financeiro-MA-${safeStart}-a-${safeEnd}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return mapExportErrorToResponse(err, 'financial_consolidated');
  }
}
