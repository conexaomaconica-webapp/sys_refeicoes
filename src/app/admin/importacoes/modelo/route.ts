import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Autenticação obrigatória.' }, { status: 401 });
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as { tenant_id: string; role: string; status: string } | null;

  if (!profile || profile.status !== 'active' || !['admin_general', 'operations_director'].includes(profile.role)) {
    return Response.json({ error: 'Sem permissão para baixar o modelo.' }, { status: 403 });
  }

  const { data: categoryData } = await supabase
    .from('student_categories')
    .select('code,name')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .order('name');
  const categories = (categoryData || []) as Array<{ code: string; name: string }>;
  const firstCategory = categories[0]?.code || 'codigo_da_categoria';

  const workbook = XLSX.utils.book_new();
  const dinersSheet = XLSX.utils.aoa_to_sheet([
    ['matricula', 'cpf', 'nome', 'categoria', 'curso_ou_setor', 'email', 'telefone', 'status'],
    ['000001', '52998224725', 'Comensal Exemplo', firstCategory, 'Curso ou setor', 'pessoa.exemplo@instituicao.edu.br', '(98) 99999-0000', 'ativo'],
  ]);
  dinersSheet['!cols'] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 34 },
    { wch: 24 },
    { wch: 28 },
    { wch: 38 },
    { wch: 20 },
    { wch: 14 },
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['Campo', 'Obrigatório', 'Orientação'],
    ['matricula', 'Sim', 'Matrícula acadêmica ou funcional, única por instituição. Zeros à esquerda são preservados.'],
    ['cpf', 'Para primeiro acesso', 'Informe os 11 dígitos. O sistema protege o CPF com HMAC e não o exibe no preview.'],
    ['nome', 'Sim', 'Nome completo, com no mínimo 3 caracteres.'],
    ['categoria', 'Sim no modo geral', 'Use exatamente um código ativo listado na aba Categorias.'],
    ['curso_ou_setor', 'Não', 'Curso do aluno ou setor do servidor/funcionário.'],
    ['email', 'Não', 'E-mail válido.'],
    ['telefone', 'Não', 'Telefone para contato.'],
    ['status', 'Não', 'Valores aceitos: ativo, inativo, suspenso, cancelado ou formado. O padrão é ativo.'],
    ['', '', 'Não altere os nomes das colunas. Remova a linha de exemplo antes da importação real.'],
  ]);
  instructionsSheet['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 88 }];

  const categoriesSheet = XLSX.utils.aoa_to_sheet([
    ['codigo', 'nome'],
    ...categories.map((category) => [category.code, category.name]),
  ]);
  categoriesSheet['!cols'] = [{ wch: 28 }, { wch: 40 }];

  XLSX.utils.book_append_sheet(workbook, dinersSheet, 'Comensais');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instrucoes');
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'Categorias');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-importacao-comensais.xlsx"',
      'Cache-Control': 'private, no-store',
    },
  });
}
