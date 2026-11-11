import { NextRequest, NextResponse } from 'next/server';
import { brazilianStateCodes } from '@/lib/brazil-locations';

interface IbgeMunicipality {
  id: number;
  nome: string;
}

interface MunicipalityDto {
  id: number;
  name: string;
}

const ufCache = new Map<string, { items: MunicipalityDto[]; expiresAt: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

async function fetchIbgeMunicipalities(state: string, withOrder: boolean): Promise<MunicipalityDto[]> {
  const suffix = withOrder ? '?orderBy=nome' : '';
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios${suffix}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SysMARefeicoes/1.0 (+https://marefeicoes.local)',
      },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok) {
    throw new Error(`IBGE respondeu com status ${response.status}.`);
  }
  const municipalities = (await response.json()) as IbgeMunicipality[];
  if (!Array.isArray(municipalities)) {
    throw new Error('Formato inesperado da resposta do IBGE.');
  }
  return municipalities
    .map((municipality) => ({
      id: municipality.id,
      name: municipality.nome,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('uf')?.trim().toUpperCase() || '';
  if (!brazilianStateCodes.has(state)) {
    return NextResponse.json({ error: 'UF inválida.' }, { status: 400 });
  }

  const cached = ufCache.get(state);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.items);
  }

  try {
    let items: MunicipalityDto[];
    try {
      items = await fetchIbgeMunicipalities(state, true);
    } catch {
      items = await fetchIbgeMunicipalities(state, false);
    }

    ufCache.set(state, { items, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(items);
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
