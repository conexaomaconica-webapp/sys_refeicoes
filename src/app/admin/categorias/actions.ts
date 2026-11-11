'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  configureUnitMealTypeServer,
  getAuthenticatedUserServer,
  getMealTypesServer,
  getUnitMealTypesServer,
} from '@/services/admin-meal.service';
import { getUnitManagementDataServer } from '@/services/admin-unit.service';

export interface MealScheduleData {
  units: Array<{
    id: string;
    name: string;
    timezone: string;
    canEdit: boolean;
  }>;
  mealTypes: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  configurations: Array<{
    id: string;
    unitId: string;
    mealTypeId: string;
    enabled: boolean;
    startTime: string | null;
    endTime: string | null;
  }>;
}

type LoadResult =
  | { success: true; data: MealScheduleData }
  | { success: false; error: string };

type SaveResult =
  | { success: true; message: string }
  | { success: false; error: string };

export interface SaveMealScheduleInput {
  unitId: string;
  mealTypeId: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function toSegments(start: string, end: string) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  return startMinutes < endMinutes
    ? [[startMinutes, endMinutes]]
    : [[startMinutes, 1439], [0, endMinutes]];
}

function schedulesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return toSegments(startA, endA).some(([aStart, aEnd]) =>
    toSegments(startB, endB).some(([bStart, bEnd]) => aStart <= bEnd && bStart <= aEnd)
  );
}

async function getIdentity() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const auth = await getAuthenticatedUserServer();
  if (!auth.userId || !auth.tenantId || auth.userId !== user.id) return null;
  return { userId: user.id, tenantId: auth.tenantId };
}

export async function loadMealScheduleAction(): Promise<LoadResult> {
  try {
    const identity = await getIdentity();
    if (!identity) return { success: false, error: 'Sessão expirada. Entre novamente.' };

    const [unitResult, mealTypeResult] = await Promise.all([
      getUnitManagementDataServer(identity.userId),
      getMealTypesServer(identity.userId, identity.tenantId),
    ]);
    if (!unitResult.data) {
      return { success: false, error: unitResult.error || 'Não foi possível carregar as unidades.' };
    }
    if (!mealTypeResult.data) {
      return { success: false, error: mealTypeResult.error || 'Não foi possível carregar as refeições.' };
    }

    const configurationResults = await Promise.all(
      unitResult.data.units.map((unit) =>
        getUnitMealTypesServer(identity.userId, identity.tenantId, unit.id)
      )
    );
    const failedConfiguration = configurationResults.find((result) => !result.data);
    if (failedConfiguration && !failedConfiguration.data) {
      return {
        success: false,
        error: failedConfiguration.error || 'Não foi possível carregar os horários das unidades.',
      };
    }

    return {
      success: true,
      data: {
        units: unitResult.data.units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          timezone: unit.timezone,
          canEdit: unit.canEdit,
        })),
        mealTypes: mealTypeResult.data
          .filter((mealType) => mealType.status === 'active')
          .map((mealType) => ({ id: mealType.id, code: mealType.code, name: mealType.name })),
        configurations: configurationResults.flatMap((result) =>
          (result.data || []).map((configuration) => ({
            id: configuration.id,
            unitId: configuration.unit_id,
            mealTypeId: configuration.meal_type_id,
            enabled: configuration.enabled,
            startTime: configuration.start_time,
            endTime: configuration.end_time,
          }))
        ),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro inesperado ao carregar os turnos.',
    };
  }
}

export async function saveMealScheduleAction(input: SaveMealScheduleInput): Promise<SaveResult> {
  try {
    const identity = await getIdentity();
    if (!identity) return { success: false, error: 'Sessão expirada. Entre novamente.' };

    const unitResult = await getUnitManagementDataServer(identity.userId);
    const unit = unitResult.data?.units.find((item) => item.id === input.unitId);
    if (!unit || !unit.canEdit) {
      return { success: false, error: 'Seu perfil não pode alterar os turnos desta unidade.' };
    }

    const mealTypeResult = await getMealTypesServer(identity.userId, identity.tenantId);
    const mealType = mealTypeResult.data?.find(
      (item) => item.id === input.mealTypeId && item.status === 'active'
    );
    if (!mealType) return { success: false, error: 'Tipo de refeição inválido.' };

    const startTime = input.startTime.trim();
    const endTime = input.endTime.trim();
    if (input.enabled && (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime))) {
      return { success: false, error: 'Informe início e fim válidos para a refeição habilitada.' };
    }
    if (input.enabled && startTime === endTime) {
      return { success: false, error: 'O início e o fim da refeição devem ser diferentes.' };
    }

    if (input.enabled) {
      const existingResult = await getUnitMealTypesServer(
        identity.userId,
        identity.tenantId,
        input.unitId
      );
      if (!existingResult.data) {
        return { success: false, error: existingResult.error || 'Não foi possível validar os horários.' };
      }
      const conflict = existingResult.data.find(
        (configuration) =>
          configuration.meal_type_id !== input.mealTypeId &&
          configuration.enabled &&
          configuration.start_time &&
          configuration.end_time &&
          schedulesOverlap(
            startTime,
            endTime,
            configuration.start_time.slice(0, 5),
            configuration.end_time.slice(0, 5)
          )
      );
      if (conflict) {
        const conflictingMeal = mealTypeResult.data?.find(
          (item) => item.id === conflict.meal_type_id
        );
        return {
          success: false,
          error: `O horário se sobrepõe a ${conflictingMeal?.name || 'outra refeição'} nesta unidade.`,
        };
      }
    }

    const result = await configureUnitMealTypeServer(identity.userId, identity.tenantId, {
      unit_id: input.unitId,
      meal_type_id: input.mealTypeId,
      enabled: input.enabled,
      start_time: input.enabled ? startTime : null,
      end_time: input.enabled ? endTime : null,
    });
    if (!result.success) {
      return { success: false, error: result.error || 'Não foi possível salvar o turno.' };
    }

    revalidatePath('/admin/categorias');
    revalidatePath('/terminal');
    return { success: true, message: `${mealType.name} atualizado com sucesso.` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro inesperado ao salvar o turno.',
    };
  }
}
