import type { Card } from '@/types/card';
import type { Wallet, WalletTransaction } from '@/types/wallet';

export interface ConsumerStudent {
  id: string;
  tenantId: string;
  fullName: string;
  registrationNumber: string;
  course: string | null;
  email: string | null;
  phone: string | null;
  photoPath: string | null;
  status: string;
  institutionName: string;
  category: {
    id: string;
    name: string;
    code: string;
    requiresWallet: boolean;
  };
}

export interface ConsumerMealConsumption {
  id: string;
  consumedAt: string;
  consumptionDate: string;
  mealTypeName: string;
  unitName: string;
  studentPrice: number;
  subsidyAmount: number;
  status: 'approved' | 'financially_refunded' | 'cancelled_unserved';
}

export interface ConsumerPreferences {
  lowBalanceEnabled: boolean;
  lowBalanceThreshold: number;
  pushEnabled: boolean;
}

export interface ConsumerPortalData {
  student: ConsumerStudent;
  wallet: Wallet | null;
  transactions: WalletTransaction[];
  consumptions: ConsumerMealConsumption[];
  card: Card | null;
  preferences: ConsumerPreferences;
}
