import type {
  OperationalDashboardFilters,
  OperationalDashboardSnapshot,
} from '@/types/operational-dashboard';
import { createBrowserClient } from '@/lib/supabase/client';

type RpcCaller = (
  functionName: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function fetchOperationalDashboardSnapshot(
  filters: OperationalDashboardFilters
): Promise<OperationalDashboardSnapshot> {
  const supabase = createBrowserClient();

  const { data, error } = await (supabase.rpc as unknown as RpcCaller)(
    'get_realtime_operational_dashboard',
    {
      p_unit_id: filters.unitId,
      p_service_date: filters.serviceDate,
      p_meal_type_id: filters.mealTypeId || null,
    }
  );

  if (error) {
    throw new Error(error.message || 'Falha ao carregar métricas operacionais em tempo real.');
  }

  return data as OperationalDashboardSnapshot;
}

