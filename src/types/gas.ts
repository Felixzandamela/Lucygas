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

export type MemberRole = 'admin' | 'manager' | 'seller' | 'driver' | 'inventory' | 'custom';
export type MemberStatus = 'invited' | 'active';

export interface MemberPermissions {
  viewDashboard: boolean;
  createSales: boolean;
  viewSales: boolean;
  manageDeliveries: boolean;
  viewInventory: boolean;
  manageInventory: boolean;
  viewCustomers: boolean;
  manageCustomers: boolean;
  viewFinance: boolean;
  manageExpenses: boolean;
  manageSettings: boolean;
  manageUsers: boolean;
}

export interface DepotMember {
  id: string;
  ownerId: string;
  memberEmails: string[];
  email: string;
  displayName: string;
  role: MemberRole;
  permissions: MemberPermissions;
  status: MemberStatus;
  joinedUid: string;
  invitedByEmail: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

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
  EMAIL: 120,
  MAX_MEMBER_EMAILS: 20,
} as const;

export interface Depot {
  id: string;
  ownerId: string;
  memberEmails?: string[];
  memberPermissions?: Record<string, MemberPermissions>;
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
  memberEmails?: string[];
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
  memberEmails?: string[];
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
  memberEmails?: string[];
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
  occurredAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StockMovement {
  id: string;
  ownerId: string;
  memberEmails?: string[];
  cylinderId: string;
  cylinderCode: string;
  movementType: MovementType;
  fullDelta: number;
  emptyDelta: number;
  note: string;
  occurredAt?: Timestamp;
  createdAt?: Timestamp;
}

export interface Expense {
  id: string;
  ownerId: string;
  memberEmails?: string[];
  category: ExpenseCategory;
  description: string;
  amount: number;
  occurredAt?: Timestamp;
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

export const FULL_ADMIN_PERMISSIONS: MemberPermissions = {
  viewDashboard: true,
  createSales: true,
  viewSales: true,
  manageDeliveries: true,
  viewInventory: true,
  manageInventory: true,
  viewCustomers: true,
  manageCustomers: true,
  viewFinance: true,
  manageExpenses: true,
  manageSettings: true,
  manageUsers: true,
};

export const LEGACY_MEMBER_PERMISSIONS: MemberPermissions = {
  ...FULL_ADMIN_PERMISSIONS,
  manageUsers: false,
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'Administrador',
  manager: 'Gerente Operacional',
  seller: 'Vendedor / Caixa',
  driver: 'Entregador / Rotas',
  inventory: 'Estoquista',
  custom: 'Personalizado',
};

export const ROLE_PRESET_PERMISSIONS: Record<Exclude<MemberRole, 'custom'>, MemberPermissions> = {
  admin: { ...FULL_ADMIN_PERMISSIONS },
  manager: {
    ...FULL_ADMIN_PERMISSIONS,
    manageUsers: false,
  },
  seller: {
    viewDashboard: true,
    createSales: true,
    viewSales: true,
    manageDeliveries: true,
    viewInventory: true,
    manageInventory: false,
    viewCustomers: true,
    manageCustomers: true,
    viewFinance: false,
    manageExpenses: false,
    manageSettings: false,
    manageUsers: false,
  },
  driver: {
    viewDashboard: false,
    createSales: false,
    viewSales: true,
    manageDeliveries: true,
    viewInventory: false,
    manageInventory: false,
    viewCustomers: true,
    manageCustomers: false,
    viewFinance: false,
    manageExpenses: false,
    manageSettings: false,
    manageUsers: false,
  },
  inventory: {
    viewDashboard: true,
    createSales: false,
    viewSales: false,
    manageDeliveries: false,
    viewInventory: true,
    manageInventory: true,
    viewCustomers: false,
    manageCustomers: false,
    viewFinance: false,
    manageExpenses: false,
    manageSettings: false,
    manageUsers: false,
  },
};

export const PERMISSION_DEFINITIONS: {
  key: keyof MemberPermissions;
  label: string;
  description: string;
  group: 'Operação e Vendas' | 'Estoque e Clientes' | 'Financeiro e Administração';
}[] = [
  {
    key: 'viewDashboard',
    label: 'Visão Geral (Painel)',
    description: 'Acompanhar indicadores operacionais e entregas do dia',
    group: 'Operação e Vendas',
  },
  {
    key: 'createSales',
    label: 'Registrar Vendas (PDV)',
    description: 'Lançar novos pedidos no balcão ou para entrega',
    group: 'Operação e Vendas',
  },
  {
    key: 'viewSales',
    label: 'Visualizar Vendas e Entregas',
    description: 'Consultar pedidos, mapa de rotas e emitir recibos',
    group: 'Operação e Vendas',
  },
  {
    key: 'manageDeliveries',
    label: 'Gerenciar Entregas e Cancelamentos',
    description: 'Despachar rotas, concluir entregas, cancelar pedidos e quitar fiado',
    group: 'Operação e Vendas',
  },
  {
    key: 'viewInventory',
    label: 'Visualizar Estoque',
    description: 'Consultar saldo de botijões cheios, cascos vazios e histórico',
    group: 'Estoque e Clientes',
  },
  {
    key: 'manageInventory',
    label: 'Gerenciar Estoque e Preços',
    description: 'Registrar reposições, ajustes, novos botijões e alterar preços',
    group: 'Estoque e Clientes',
  },
  {
    key: 'viewCustomers',
    label: 'Visualizar Clientes',
    description: 'Consultar cadastro, endereços e saldo de fiado',
    group: 'Estoque e Clientes',
  },
  {
    key: 'manageCustomers',
    label: 'Cadastrar e Editar Clientes',
    description: 'Adicionar clientes, atualizar contatos e receber fiado',
    group: 'Estoque e Clientes',
  },
  {
    key: 'viewFinance',
    label: 'Ver Financeiro, Custos e Lucros',
    description: 'Acessar caixa, margens, lucro líquido e extrato de lucros em PDF',
    group: 'Financeiro e Administração',
  },
  {
    key: 'manageExpenses',
    label: 'Lançar e Excluir Despesas',
    description: 'Registrar custos operacionais e despesas no caixa',
    group: 'Financeiro e Administração',
  },
  {
    key: 'manageSettings',
    label: 'Configurações da Distribuidora',
    description: 'Alterar nome, moeda, taxa de entrega, entregadores e histórico',
    group: 'Financeiro e Administração',
  },
  {
    key: 'manageUsers',
    label: 'Gestão de Usuários',
    description: 'Convidar novos colaboradores por e-mail e definir permissões',
    group: 'Financeiro e Administração',
  },
];

export function normalizePermissions(
  raw?: Partial<MemberPermissions> | null,
  fallback: MemberPermissions = LEGACY_MEMBER_PERMISSIONS
): MemberPermissions {
  if (!raw) return { ...fallback };
  return {
    viewDashboard: typeof raw.viewDashboard === 'boolean' ? raw.viewDashboard : fallback.viewDashboard,
    createSales: typeof raw.createSales === 'boolean' ? raw.createSales : fallback.createSales,
    viewSales: typeof raw.viewSales === 'boolean' ? raw.viewSales : fallback.viewSales,
    manageDeliveries:
      typeof raw.manageDeliveries === 'boolean' ? raw.manageDeliveries : fallback.manageDeliveries,
    viewInventory: typeof raw.viewInventory === 'boolean' ? raw.viewInventory : fallback.viewInventory,
    manageInventory:
      typeof raw.manageInventory === 'boolean' ? raw.manageInventory : fallback.manageInventory,
    viewCustomers: typeof raw.viewCustomers === 'boolean' ? raw.viewCustomers : fallback.viewCustomers,
    manageCustomers:
      typeof raw.manageCustomers === 'boolean' ? raw.manageCustomers : fallback.manageCustomers,
    viewFinance: typeof raw.viewFinance === 'boolean' ? raw.viewFinance : fallback.viewFinance,
    manageExpenses:
      typeof raw.manageExpenses === 'boolean' ? raw.manageExpenses : fallback.manageExpenses,
    manageSettings:
      typeof raw.manageSettings === 'boolean' ? raw.manageSettings : fallback.manageSettings,
    manageUsers: typeof raw.manageUsers === 'boolean' ? raw.manageUsers : fallback.manageUsers,
  };
}

export function inferRoleFromPermissions(perms: MemberPermissions): MemberRole {
  const presets: Exclude<MemberRole, 'custom'>[] = ['admin', 'manager', 'seller', 'driver', 'inventory'];
  const keys = Object.keys(FULL_ADMIN_PERMISSIONS) as (keyof MemberPermissions)[];
  for (const role of presets) {
    const preset = ROLE_PRESET_PERMISSIONS[role];
    if (keys.every((k) => Boolean(perms[k]) === Boolean(preset[k]))) {
      return role;
    }
  }
  return 'custom';
}

export function resolveEffectivePermissions(
  depot: Depot | null,
  userUid: string,
  userEmail: string
): MemberPermissions {
  if (!depot) return { ...FULL_ADMIN_PERMISSIONS };
  if (depot.ownerId === userUid) return { ...FULL_ADMIN_PERMISSIONS };
  const cleanEmail = userEmail.trim().toLowerCase();
  const explicit = cleanEmail ? depot.memberPermissions?.[cleanEmail] : undefined;
  if (explicit) {
    return normalizePermissions(explicit, LEGACY_MEMBER_PERMISSIONS);
  }
  return { ...LEGACY_MEMBER_PERMISSIONS };
}

