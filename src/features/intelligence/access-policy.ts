import type { UserRole } from '../../types/auth';
import type { IntelligenceAccessContext } from './contracts';
import type { IntelligenceIndicatorContract, IntelligenceIndicatorId } from './indicator-catalog';
import { intelligenceIndicatorCatalog, remoteIntegrationGates } from './indicator-catalog';

export interface IntelligenceRolePolicy {
  role: UserRole;
  dashboardAccess: 'tenant' | 'institution' | 'unit' | 'none';
  classifications: ReadonlyArray<'operational' | 'financial'>;
  notes: string;
}

export const intelligenceRolePolicies: readonly IntelligenceRolePolicy[] = [
  { role: 'admin_general', dashboardAccess: 'tenant', classifications: ['operational', 'financial'], notes: 'Visão global do próprio tenant; toda ação permanece auditável.' },
  { role: 'operations_director', dashboardAccess: 'tenant', classifications: ['operational', 'financial'], notes: 'Visão consolidada; escrita financeira não faz parte da Central.' },
  { role: 'finance', dashboardAccess: 'tenant', classifications: ['operational', 'financial'], notes: 'Leitura financeira global no tenant, condicionada ao contrato contábil.' },
  { role: 'supervisor', dashboardAccess: 'unit', classifications: ['operational'], notes: 'Somente instituições e unidades explicitamente atribuídas.' },
  { role: 'unit_manager', dashboardAccess: 'unit', classifications: ['operational'], notes: 'Somente a própria unidade; sem indicadores financeiros globais.' },
  { role: 'operator', dashboardAccess: 'none', classifications: [], notes: 'O operador atua no terminal e não possui dashboard gerencial.' },
  { role: 'institution_user', dashboardAccess: 'institution', classifications: ['operational'], notes: 'Somente visão institucional resumida/detalhada autorizada.' },
  { role: 'student', dashboardAccess: 'none', classifications: [], notes: 'Consumidor não acessa superfícies administrativas.' },
];

export interface RemoteIntegrationReadiness {
  eligible: boolean;
  indicator: IntelligenceIndicatorContract | null;
  blockers: string[];
}

export function evaluateRemoteIntegrationReadiness(
  indicatorId: IntelligenceIndicatorId,
  access: IntelligenceAccessContext,
  approvedGates: readonly string[] = []
): RemoteIntegrationReadiness {
  const indicator = intelligenceIndicatorCatalog.find((item) => item.id === indicatorId) ?? null;
  const blockers: string[] = [];
  if (!indicator) return { eligible: false, indicator, blockers: ['Indicador desconhecido.'] };
  if (access.mode !== 'authenticated') blockers.push('Contexto autenticado obrigatório para fornecedor remoto.');
  if (!access.tenantId) blockers.push('Tenant explícito obrigatório.');
  if (access.profileStatus !== 'active') blockers.push('Perfil ativo obrigatório.');
  const policy = intelligenceRolePolicies.find((item) => item.role === access.role);
  if (!policy || policy.dashboardAccess === 'none') blockers.push('Perfil sem acesso à Central de Inteligência.');
  if (policy && !policy.classifications.includes(indicator.classification)) blockers.push('Classificação do indicador não permitida para o perfil.');
  if (policy?.dashboardAccess === 'institution' && access.institutionIds.length === 0) blockers.push('Escopo institucional obrigatório.');
  if (policy?.dashboardAccess === 'unit' && access.unitIds.length === 0) blockers.push('Escopo de unidade obrigatório.');
  for (const gate of remoteIntegrationGates) {
    if (!approvedGates.includes(gate)) blockers.push(gate);
  }
  blockers.push(...indicator.blockedBy.filter((blocker) => !approvedGates.includes(blocker)));
  return { eligible: blockers.length === 0, indicator, blockers: [...new Set(blockers)] };
}
