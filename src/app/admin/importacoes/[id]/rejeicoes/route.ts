import { NextRequest, NextResponse } from 'next/server';
import { AdminImportService } from '@/services/admin-import.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
    if (format === 'csv') {
      const csv = await AdminImportService.generateErrorCsvReport(id);
      return new NextResponse(`\uFEFF${csv}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="rejeicoes-${id}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const workbook = await AdminImportService.generateErrorXlsxReport(id);
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="rejeicoes-${id}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível gerar o relatório.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
