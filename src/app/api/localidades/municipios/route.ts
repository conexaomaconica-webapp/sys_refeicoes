import { NextRequest, NextResponse } from 'next/server';
import { brazilianStateCodes } from '@/lib/brazil-locations';

interface IbgeMunicipality {
  id: number;
  nome: string;
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('uf')?.trim().toUpperCase() || '';
  if (!brazilianStateCodes.has(state)) {
    return NextResponse.json({ error: 'UF inválida.' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios?orderBy=nome`,
      {
        headers: { Accept: 'application/json' },
        next: { revalidate: 60 * 60 * 24 * 30 },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) throw new Error(`IBGE respondeu com status ${response.status}.`);

    const municipalities = (await response.json()) as IbgeMunicipality[];
    return NextResponse.json(
      municipalities.map((municipality) => ({
        id: municipality.id,
        name: municipality.nome,
      }))
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Não foi possível consultar os municípios do IBGE.',
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 503 }
    );
  }
}
