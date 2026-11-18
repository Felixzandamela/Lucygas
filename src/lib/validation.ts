import type { KeyboardEvent } from 'react';
import { FIELD_LIMITS } from '../types/gas';

export function preventNegativeNumberKeys(
  e: KeyboardEvent<HTMLInputElement>,
  allowDecimal = true
): void {
  const blocked = allowDecimal ? ['-', '+', 'e', 'E'] : ['-', '+', 'e', 'E', '.', ','];
  if (blocked.includes(e.key)) {
    e.preventDefault();
  }
}

export function sanitizeNumericText(raw: string, allowDecimal = true): string {
  const normalized = raw.replace(/,/g, '.');
  let out = '';
  let hasDot = false;
  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (allowDecimal && ch === '.' && !hasDot) {
      out += ch;
      hasDot = true;
    }
  }
  return out;
}

export function parseStrictNumber(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const trimmed = raw.trim().replace(/,/g, '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isValidPastOrTodayIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return false;
  }
  return dateStr <= getTodayIsoDate();
}

export function isValidImageUrlInput(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.length > FIELD_LIMITS.IMAGE_URL) return false;
  if (trimmed.startsWith('data:image/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ValidatedCylinderPayload {
  code: string;
  name: string;
  weightKg: number;
  fullCount: number;
  emptyCount: number;
  salePrice: number;
  shellPrice: number;
  costPrice: number;
  minStock: number;
  imageUrl: string;
}

export function validateCylinderForm(
  input: {
    code: string;
    name: string;
    weightKg: string | number;
    fullCount?: string | number;
    emptyCount?: string | number;
    salePrice: string | number;
    shellPrice: string | number;
    costPrice: string | number;
    minStock: string | number;
    imageUrl: string;
  },
  options: {
    isCreate: boolean;
    existingCodes: string[];
    currentCode?: string;
  }
): ValidationResult<ValidatedCylinderPayload> {
  const code = input.code.trim();
  const name = input.name.trim();

  if (!code) {
    return { ok: false, error: 'Informe o código do produto (ex.: P9, P13, M12).' };
  }
  if (code.length > FIELD_LIMITS.CYLINDER_CODE) {
    return {
      ok: false,
      error: `O código do produto deve ter no máximo ${FIELD_LIMITS.CYLINDER_CODE} caracteres.`,
    };
  }
  const normalizedCode = code.toUpperCase();
  const normalizedCurrent = options.currentCode?.trim().toUpperCase();
  const isDuplicate = options.existingCodes.some(
    (c) => c.trim().toUpperCase() === normalizedCode && c.trim().toUpperCase() !== normalizedCurrent
  );
  if (isDuplicate) {
    return {
      ok: false,
      error: `Já existe um produto cadastrado com o código "${code}". Use um código diferente.`,
    };
  }

  if (!name) {
    return { ok: false, error: 'Informe o nome / descrição do produto.' };
  }
  if (name.length > FIELD_LIMITS.CYLINDER_NAME) {
    return {
      ok: false,
      error: `A descrição do produto deve ter no máximo ${FIELD_LIMITS.CYLINDER_NAME} caracteres.`,
    };
  }

  const weightKg = parseStrictNumber(input.weightKg);
  if (weightKg === null || weightKg <= 0 || weightKg > 1000) {
    return {
      ok: false,
      error: 'Informe um peso válido maior que zero e até 1.000 kg.',
    };
  }

  let fullCount = 0;
  let emptyCount = 0;
  if (options.isCreate) {
    const parsedFull = parseStrictNumber(input.fullCount ?? '');
    if (parsedFull === null || parsedFull < 0 || !Number.isInteger(parsedFull) || parsedFull > 100000) {
      return {
        ok: false,
        error: 'Cheios iniciais deve ser um número inteiro maior ou igual a 0 (máx. 100.000).',
      };
    }
    const parsedEmpty = parseStrictNumber(input.emptyCount ?? '');
    if (parsedEmpty === null || parsedEmpty < 0 || !Number.isInteger(parsedEmpty) || parsedEmpty > 100000) {
      return {
        ok: false,
        error: 'Vazios iniciais deve ser um número inteiro maior ou igual a 0 (máx. 100.000).',
      };
    }
    fullCount = parsedFull;
    emptyCount = parsedEmpty;
  }

  const salePrice = parseStrictNumber(input.salePrice);
  if (salePrice === null || salePrice <= 0 || salePrice > 1000000) {
    return {
      ok: false,
      error: 'Informe um preço de recarga (troca) válido maior que zero.',
    };
  }

  const shellPrice = parseStrictNumber(input.shellPrice);
  if (shellPrice === null || shellPrice < 0 || shellPrice > 1000000) {
    return {
      ok: false,
      error: 'O adicional de casco novo não pode ser vazio ou negativo.',
    };
  }

  const costPrice = parseStrictNumber(input.costPrice);
  if (costPrice === null || costPrice < 0 || costPrice > 1000000) {
    return {
      ok: false,
      error: 'O custo de reposição não pode ser vazio ou negativo.',
    };
  }

  const minStock = parseStrictNumber(input.minStock);
  if (minStock === null || minStock < 0 || !Number.isInteger(minStock) || minStock > 10000) {
    return {
      ok: false,
      error: 'O alerta de estoque mínimo deve ser um número inteiro maior ou igual a 0 (máx. 10.000).',
    };
  }

  const imageUrl = input.imageUrl.trim();
  if (imageUrl && !isValidImageUrlInput(imageUrl)) {
    return {
      ok: false,
      error: 'Informe uma URL de imagem válida (https://...) ou envie uma foto do dispositivo.',
    };
  }

  return {
    ok: true,
    data: {
      code,
      name,
      weightKg,
      fullCount,
      emptyCount,
      salePrice,
      shellPrice,
      costPrice,
      minStock,
      imageUrl,
    },
  };
}

export function validateStockMovementForm(input: {
  movementType: 'restock' | 'return_empty' | 'adjustment';
  fullQty: string | number;
  emptyQty: string | number;
  currentFull: number;
  currentEmpty: number;
  note: string;
  movementDate: string;
}): ValidationResult<{ fullDelta: number; emptyDelta: number; note: string; occurredAt?: Date }> {
  if (input.note.trim().length > FIELD_LIMITS.MOVEMENT_NOTE) {
    return {
      ok: false,
      error: `A observação deve ter no máximo ${FIELD_LIMITS.MOVEMENT_NOTE} caracteres.`,
    };
  }

  if (input.movementDate && !isValidPastOrTodayIsoDate(input.movementDate)) {
    return {
      ok: false,
      error: 'Informe uma data de movimentação válida que não esteja no futuro.',
    };
  }

  const occurredAt = input.movementDate ? new Date(`${input.movementDate}T12:00:00`) : undefined;

  if (input.movementType === 'restock') {
    const full = parseStrictNumber(input.fullQty);
    const empty = parseStrictNumber(input.emptyQty);

    if (full === null || full < 0 || !Number.isInteger(full) || full > 10000) {
      return {
        ok: false,
        error: 'Botijões cheios recebidos deve ser um número inteiro maior ou igual a 0 (máx. 10.000).',
      };
    }
    if (empty === null || empty < 0 || !Number.isInteger(empty) || empty > 10000) {
      return {
        ok: false,
        error: 'Cascos vazios entregues deve ser um número inteiro maior ou igual a 0.',
      };
    }
    if (empty > input.currentEmpty) {
      return {
        ok: false,
        error: `Não é possível entregar ${empty} cascos vazios: há apenas ${input.currentEmpty} disponíveis no pátio.`,
      };
    }
    if (full === 0 && empty === 0) {
      return {
        ok: false,
        error: 'Informe pelo menos 1 botijão cheio recebido ou 1 casco vazio entregue.',
      };
    }
    return {
      ok: true,
      data: {
        fullDelta: full,
        emptyDelta: -empty,
        note: input.note.trim(),
        occurredAt,
      },
    };
  }

  if (input.movementType === 'return_empty') {
    const empty = parseStrictNumber(input.emptyQty);
    if (empty === null || empty < 1 || !Number.isInteger(empty) || empty > 10000) {
      return {
        ok: false,
        error: 'Informe uma quantidade inteira de cascos vazios devolvidos entre 1 e 10.000.',
      };
    }
    return {
      ok: true,
      data: {
        fullDelta: 0,
        emptyDelta: empty,
        note: input.note.trim(),
        occurredAt,
      },
    };
  }

  // adjustment (direct balance)
  const full = parseStrictNumber(input.fullQty);
  const empty = parseStrictNumber(input.emptyQty);
  if (full === null || full < 0 || !Number.isInteger(full) || full > 100000) {
    return {
      ok: false,
      error: 'Total de cheios atual deve ser um número inteiro maior ou igual a 0 (máx. 100.000).',
    };
  }
  if (empty === null || empty < 0 || !Number.isInteger(empty) || empty > 100000) {
    return {
      ok: false,
      error: 'Total de vazios atual deve ser um número inteiro maior ou igual a 0 (máx. 100.000).',
    };
  }
  const fullDelta = full - input.currentFull;
  const emptyDelta = empty - input.currentEmpty;
  if (Math.abs(fullDelta) > 10000 || Math.abs(emptyDelta) > 10000) {
    return {
      ok: false,
      error: 'A diferença máxima por ajuste manual é de 10.000 unidades.',
    };
  }

  return {
    ok: true,
    data: {
      fullDelta,
      emptyDelta,
      note: input.note.trim(),
      occurredAt,
    },
  };
}

export function validateSaleOrderForm(input: {
  hasSelectedCylinder: boolean;
  cylinderCode: string;
  availableFullCount: number;
  unitPrice: number;
  quantity: string | number;
  discount: string | number;
  deliveryFee: string | number;
  fulfillmentType: 'delivery' | 'pickup';
  hasSelectedCustomer: boolean;
  walkInName: string;
  walkInPhone: string;
  deliveryAddress: string;
  notes: string;
  saleDate: string;
}): ValidationResult<{
  quantity: number;
  discount: number;
  deliveryFee: number;
  walkInName: string;
  occurredAt?: Date;
}> {
  if (!input.hasSelectedCylinder) {
    return { ok: false, error: 'Selecione um tipo de botijão antes de finalizar a venda.' };
  }

  const quantity = parseStrictNumber(input.quantity);
  if (quantity === null || quantity < 1 || !Number.isInteger(quantity) || quantity > 500) {
    return {
      ok: false,
      error: 'A quantidade da venda deve ser um número inteiro entre 1 e 500 unidades.',
    };
  }

  if (input.availableFullCount < quantity) {
    return {
      ok: false,
      error: `Estoque insuficiente de ${input.cylinderCode}. Disponível: ${input.availableFullCount} unidade(s).`,
    };
  }

  const deliveryFee =
    input.fulfillmentType === 'delivery' ? parseStrictNumber(input.deliveryFee) : 0;
  if (deliveryFee === null || deliveryFee < 0 || deliveryFee > 100000) {
    return {
      ok: false,
      error: 'A taxa de entrega não pode ser vazia ou negativa.',
    };
  }

  const discount = parseStrictNumber(input.discount);
  if (discount === null || discount < 0 || discount > 1000000) {
    return {
      ok: false,
      error: 'O desconto não pode ser vazio ou negativo.',
    };
  }

  const grossTotal = input.unitPrice * quantity + deliveryFee;
  if (discount > grossTotal) {
    return {
      ok: false,
      error: 'O desconto não pode ser maior que o valor total do pedido.',
    };
  }

  const cleanWalkInName = input.walkInName.trim();
  if (!input.hasSelectedCustomer && !cleanWalkInName) {
    return {
      ok: false,
      error: 'Informe o nome do cliente ou selecione um cliente cadastrado.',
    };
  }
  if (!input.hasSelectedCustomer && cleanWalkInName.length > FIELD_LIMITS.CUSTOMER_NAME) {
    return {
      ok: false,
      error: `O nome do cliente deve ter no máximo ${FIELD_LIMITS.CUSTOMER_NAME} caracteres.`,
    };
  }
  if (!input.hasSelectedCustomer && input.walkInPhone.trim().length > FIELD_LIMITS.PHONE) {
    return {
      ok: false,
      error: `O telefone deve ter no máximo ${FIELD_LIMITS.PHONE} caracteres.`,
    };
  }

  if (input.fulfillmentType === 'delivery' && !input.deliveryAddress.trim()) {
    return {
      ok: false,
      error: 'Informe o endereço de entrega ou altere para Retirada no Balcão.',
    };
  }
  if (input.fulfillmentType === 'delivery' && input.deliveryAddress.trim().length > FIELD_LIMITS.ADDRESS) {
    return {
      ok: false,
      error: `O endereço de entrega deve ter no máximo ${FIELD_LIMITS.ADDRESS} caracteres.`,
    };
  }

  if (input.notes.trim().length > FIELD_LIMITS.NOTES) {
    return {
      ok: false,
      error: `As observações devem ter no máximo ${FIELD_LIMITS.NOTES} caracteres.`,
    };
  }

  if (input.saleDate && !isValidPastOrTodayIsoDate(input.saleDate)) {
    return {
      ok: false,
      error: 'Informe uma data de venda válida que não esteja no futuro.',
    };
  }

  return {
    ok: true,
    data: {
      quantity,
      discount,
      deliveryFee,
      walkInName: cleanWalkInName,
      occurredAt: input.saleDate ? new Date(`${input.saleDate}T12:00:00`) : undefined,
    },
  };
}

export function validateCustomerForm(input: {
  name: string;
  phone: string;
  address: string;
  neighborhood: string;
  notes: string;
}): ValidationResult<{
  name: string;
  phone: string;
  address: string;
  neighborhood: string;
  notes: string;
}> {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: 'Informe o nome do cliente.' };
  }
  if (name.length > FIELD_LIMITS.CUSTOMER_NAME) {
    return {
      ok: false,
      error: `O nome do cliente deve ter no máximo ${FIELD_LIMITS.CUSTOMER_NAME} caracteres.`,
    };
  }
  if (input.phone.trim().length > FIELD_LIMITS.PHONE) {
    return {
      ok: false,
      error: `O telefone deve ter no máximo ${FIELD_LIMITS.PHONE} caracteres.`,
    };
  }
  if (input.address.trim().length > FIELD_LIMITS.ADDRESS) {
    return {
      ok: false,
      error: `O endereço deve ter no máximo ${FIELD_LIMITS.ADDRESS} caracteres.`,
    };
  }
  if (input.neighborhood.trim().length > FIELD_LIMITS.NEIGHBORHOOD) {
    return {
      ok: false,
      error: `O bairro deve ter no máximo ${FIELD_LIMITS.NEIGHBORHOOD} caracteres.`,
    };
  }
  if (input.notes.trim().length > FIELD_LIMITS.NOTES) {
    return {
      ok: false,
      error: `As observações devem ter no máximo ${FIELD_LIMITS.NOTES} caracteres.`,
    };
  }

  return {
    ok: true,
    data: {
      name,
      phone: input.phone.trim(),
      address: input.address.trim(),
      neighborhood: input.neighborhood.trim(),
      notes: input.notes.trim(),
    },
  };
}

export function validateCreditPaymentForm(
  rawAmount: string | number,
  maxBalance: number
): ValidationResult<number> {
  const amount = parseStrictNumber(rawAmount);
  if (amount === null || amount <= 0) {
    return {
      ok: false,
      error: 'Informe um valor recebido válido maior que zero.',
    };
  }
  if (amount > maxBalance + 0.0001) {
    return {
      ok: false,
      error: 'O valor recebido não pode ser maior que o saldo devedor do cliente.',
    };
  }
  return { ok: true, data: Math.min(amount, maxBalance) };
}

export function validateExpenseForm(input: {
  description: string;
  amount: string | number;
}): ValidationResult<{ description: string; amount: number }> {
  const description = input.description.trim();
  if (!description) {
    return { ok: false, error: 'Informe a descrição da despesa.' };
  }
  if (description.length > FIELD_LIMITS.EXPENSE_DESC) {
    return {
      ok: false,
      error: `A descrição deve ter no máximo ${FIELD_LIMITS.EXPENSE_DESC} caracteres.`,
    };
  }
  const amount = parseStrictNumber(input.amount);
  if (amount === null || amount <= 0 || amount > 100000000) {
    return {
      ok: false,
      error: 'Informe um valor de despesa válido maior que zero.',
    };
  }
  return { ok: true, data: { description, amount } };
}

export function validateDepotSettingsForm(input: {
  name: string;
  deliveryFee: string | number;
}): ValidationResult<{ name: string; deliveryFee: number }> {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: 'Informe o nome da distribuidora.' };
  }
  if (name.length > FIELD_LIMITS.DEPOT_NAME) {
    return {
      ok: false,
      error: `O nome da distribuidora deve ter no máximo ${FIELD_LIMITS.DEPOT_NAME} caracteres.`,
    };
  }
  const deliveryFee = parseStrictNumber(input.deliveryFee);
  if (deliveryFee === null || deliveryFee < 0 || deliveryFee > 10000) {
    return {
      ok: false,
      error: 'A taxa padrão de entrega deve ser maior ou igual a zero (máx. 10.000).',
    };
  }
  return { ok: true, data: { name, deliveryFee } };
}
