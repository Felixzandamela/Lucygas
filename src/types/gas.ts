import type { Timestamp } from 'firebase/firestore';

export type CurrencyCode = 'BRL' | 'MZN' | 'EUR';
export type SaleMode = 'exchange' | 'full_with_shell';
export type FulfillmentType = 'delivery' | 'pickup';
export type PaymentMethod = 'mpesa' | 'emola' | 'cash' | 'card' | 'credit' | 'pix';
export type SelectablePaymentMethod = 'mpesa' | 'emola' | 'cash' | 'card' | 'credit';
export type PaymentStatus = 'paid' | 'pending';
export type DeliveryStatus = 'pending' | 'in_route' | 'delivered' | 'cancelled';
export type MovementType = 'restock' | 'sale' | 'return_empty' | 'adjustment' | 'cancel_restore';
export type ExpenseCategory = 'restock' | 'fuel' | 'maintenance' | 'payroll' | 'other';

export const FIELD_LIMITS = {
  DEPOT_NAME: 80,
  DRIVER_NAME: 60,
  MAX_DRIVERS: 20,
  CYLINDER_CODE: 20,
  CYLINDER_NAME: 60,
  CUSTOMER_NAME: 80,
  PHONE: 30,
  ADDRESS: 160,
  NEIGHBORHOOD: 80,
  NOTES: 240,
  MOVEMENT_NOTE: 160,
  EXPENSE_DESC: 120,
  IMAGE_URL: 150000,
} as const;

export interface Depot {
  id: string;
  ownerId: string;
  name: string;
  currency: CurrencyCode;
  deliveryFee: number;
  drivers: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Cylinder {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  weightKg: number;
  fullCount: number;
  emptyCount: number;
  salePrice: number;
  shellPrice: number;
  costPrice: number;
  minStock: number;
  imageUrl?: string;
  updatedAt?: Timestamp;
}

export interface Customer {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  address: string;
  neighborhood: string;
  notes: string;
  totalOrders: number;
  totalSpent: number;
  creditBalance: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Sale {
  id: string;
  ownerId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  cylinderId: string;
  cylinderCode: string;
  saleMode: SaleMode;
  quantity: number;
  unitPrice: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  unitCost: number;
  fulfillmentType: FulfillmentType;
  driverName: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StockMovement {
  id: string;
  ownerId: string;
  cylinderId: string;
  cylinderCode: string;
  movementType: MovementType;
  fullDelta: number;
  emptyDelta: number;
  note: string;
  createdAt?: Timestamp;
}

export interface Expense {
  id: string;
  ownerId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  createdAt?: Timestamp;
}

export type AppSection =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'inventory'
  | 'customers'
  | 'finance'
  | 'settings';

export const SELECTABLE_PAYMENT_METHODS: SelectablePaymentMethod[] = [
  'cash',
  'mpesa',
  'emola',
  'card',
  'credit',
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  cash: 'Dinheiro',
  card: 'Cartão',
  credit: 'Fiado / A Prazo',
  pix: 'Transferência',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pendente',
  in_route: 'Em Rota',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  restock: 'Reposição de Carga',
  fuel: 'Combustível e Frota',
  maintenance: 'Manutenção',
  payroll: 'Equipe e Entregadores',
  other: 'Outras Despesas',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  restock: 'Entrada de Carga',
  sale: 'Saída por Venda',
  return_empty: 'Retorno de Casco',
  adjustment: 'Ajuste Manual',
  cancel_restore: 'Estorno de Cancelamento',
};
