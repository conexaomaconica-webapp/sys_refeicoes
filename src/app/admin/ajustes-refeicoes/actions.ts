'use server';

import { revalidatePath } from 'next/cache';
import {
  analyzeMonthlySmartGapsServer,
  analyzeMonthlySmartMultiServer,
  previewAdjustmentDateServer,
  previewMultiShiftsDateServer,
  reviewSmartAdjustmentCampaignServer,
  submitRetroactiveDateDistributionServer,
  submitSmartAdjustmentCampaignServer,
  upsertUnitCalendarServer,
} from '@/server/adjustments/smart-adjustment.service';
import type {
  DateContextPreview,
  SmartAnalysisResult,
  SmartDistributionLineInput,
  SmartMultiAnalysisResult,
  SubmitRetroactiveDistributionInput,
  SubmitSmartCampaignInput,
  UnitCalendarDay,
} from '@/types/adjustments';

export async function previewAdjustmentDateAction(
  unitId: string,
  mealTypeId: string,
  serviceDate: string
): Promise<{ success: boolean; preview?: DateContextPreview; error?: string }> {
  try {
    if (!unitId || !mealTypeId || !serviceDate) {
      return { success: false, error: 'Selecione unidade, refeição e data para gerar a prévia.' };
    }
    const preview = await previewAdjustmentDateServer(unitId, mealTypeId, serviceDate);
    return { success: true, preview };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function previewMultiShiftsDateAction(
  unitId: string,
  mealTypeIds: string[],
  serviceDate: string
): Promise<{
  success: boolean;
  previews?: Array<{ meal_type_id: string; preview: DateContextPreview }>;
  error?: string;
}> {
  try {
    if (!unitId || !serviceDate || mealTypeIds.length === 0) {
      return { success: false, error: 'Selecione unidade, data e ao menos um turno.' };
    }
    const previews = await previewMultiShiftsDateServer(unitId, mealTypeIds, serviceDate);
    return { success: true, previews };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function analyzeMonthlySmartGapsAction(input: {
  unitId: string;
  mealTypeId: string;
  categoryId?: string | null;
  competenceMonth: string;
  provenTotalMeals: number;
  dailyServedEvidence?: Record<string, { physicalTotalServed: number; sourceRef: string }>;
  allowClosedDates?: boolean;
}): Promise<{ success: boolean; analysis?: SmartAnalysisResult; error?: string }> {
  try {
    if (!input.unitId || !input.mealTypeId || !input.competenceMonth) {
      return { success: false, error: 'Selecione unidade, competência e refeição.' };
    }
    if (!Number.isFinite(input.provenTotalMeals) || input.provenTotalMeals <= 0) {
      return { success: false, error: 'Informe uma quantidade comprovada maior que zero.' };
    }
    const analysis = await analyzeMonthlySmartGapsServer(input);
    return { success: true, analysis };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function analyzeMonthlySmartMultiAction(input: {
  unitId: string;
  competenceMonth: string;
  provenTotalMeals: number;
  lines: SmartDistributionLineInput[];
  dailyServedEvidence?: Record<string, { physicalTotalServed: number; sourceRef: string }>;
  allowClosedDates?: boolean;
}): Promise<{ success: boolean; analysis?: SmartMultiAnalysisResult; error?: string }> {
  try {
    if (!input.unitId || !input.competenceMonth) {
      return { success: false, error: 'Selecione unidade e competência.' };
    }
    if (!Number.isFinite(input.provenTotalMeals) || input.provenTotalMeals <= 0) {
      return { success: false, error: 'Informe um total comprovado maior que zero.' };
    }
    if (!input.lines || input.lines.length === 0) {
      return { success: false, error: 'Adicione ao menos uma linha (turno + categoria + quantidade).' };
    }
    const analysis = await analyzeMonthlySmartMultiServer(input);
    return { success: true, analysis };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function submitRetroactiveDateDistributionAction(input: SubmitRetroactiveDistributionInput) {
  try {
    if (!input.unit_id || !input.service_date) {
      return { success: false, error: 'Unidade e data são obrigatórias.' };
    }
    if (!input.lines || input.lines.length === 0) {
      return { success: false, error: 'Informe ao menos uma linha de regularização (turno + categoria + quantidade).' };
    }
    if (!input.justification || input.justification.trim().length < 10) {
      return { success: false, error: 'Justificativa detalhada obrigatória (mínimo 10 caracteres).' };
    }
    const res = await submitRetroactiveDateDistributionServer(input);
    if (res.success) {
      revalidatePath('/admin/ajustes-refeicoes');
      revalidatePath('/admin/contingencia');
    }
    return res;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function upsertUnitCalendarAction(input: UnitCalendarDay) {
  try {
    const res = await upsertUnitCalendarServer(input);
    if (res.success) {
      revalidatePath('/admin/ajustes-refeicoes');
    }
    return res;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function submitSmartAdjustmentCampaignAction(input: SubmitSmartCampaignInput) {
  try {
    if (!input.justification || input.justification.trim().length < 10) {
      return {
        success: false,
        error: 'Justificativa detalhada obrigatória (mínimo de 10 caracteres).',
      };
    }
    const res = await submitSmartAdjustmentCampaignServer(input);
    if (res.success) {
      revalidatePath('/admin/ajustes-refeicoes');
      revalidatePath('/admin/contingencia');
    }
    return res;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function reviewSmartAdjustmentCampaignAction(
  campaignId: string,
  action: 'approve' | 'reject',
  reason?: string
) {
  try {
    if (!campaignId) return { success: false, error: 'Campanha não informada.' };
    if (action === 'reject' && (!reason || reason.trim().length < 5)) {
      return { success: false, error: 'Informe o motivo da rejeição (mínimo 5 caracteres).' };
    }
    const res = await reviewSmartAdjustmentCampaignServer(campaignId, action, reason);
    if (res.success) {
      revalidatePath('/admin/ajustes-refeicoes');
      revalidatePath('/admin/contingencia');
      revalidatePath('/admin/relatorios');
    }
    return res;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

