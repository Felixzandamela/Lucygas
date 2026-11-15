import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { clampNonNegative, generateOrderNumber, sanitizeText } from '../lib/formatters';
import {
  type CurrencyCode,
  type Customer,
  type Cylinder,
  type DeliveryStatus,
  type ExpenseCategory,
  FIELD_LIMITS,
  type FulfillmentType,
  type MovementType,
  type PaymentMethod,
  type Sale,
  type SaleMode,
} from '../types/gas';

const DEFAULT_CYLINDERS = [
  {
    id: 'p8',
    code: 'P8',
    name: 'Botijão P8 (8 kg)',
    weightKg: 8,
    fullCount: 16,
    emptyCount: 5,
    salePrice: 85,
    shellPrice: 150,
    costPrice: 58,
    minStock: 5,
  },
  {
    id: 'p13',
    code: 'P13',
    name: 'Botijão P13 Residencial (13 kg)',
    weightKg: 13,
    fullCount: 58,
    emptyCount: 20,
    salePrice: 115,
    shellPrice: 185,
    costPrice: 81,
    minStock: 15,
  },
  {
    id: 'p20',
    code: 'P20',
    name: 'Cilindro P20 Empilhadeira (20 kg)',
    weightKg: 20,
    fullCount: 10,
    emptyCount: 4,
    salePrice: 198,
    shellPrice: 320,
    costPrice: 142,
    minStock: 4,
  },
  {
    id: 'p45',
    code: 'P45',
    name: 'Cilindro P45 Comercial (45 kg)',
    weightKg: 45,
    fullCount: 8,
    emptyCount: 3,
    salePrice: 415,
    shellPrice: 660,
    costPrice: 305,
    minStock: 3,
  },
];

async function executeFirestoreWrite(
  writePromise: Promise<void>,
  opType: OperationType,
  path: string
): Promise<void> {
  let settled = false;

  const guarded = writePromise.catch((error) => {
    if (!settled) {
      handleFirestoreError(error, opType, path);
    } else {
      console.error('Erro na sincronização em segundo plano:', error);
    }
  });

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    settled = true;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return;
  }

  await Promise.race([
    guarded.then(() => {
      settled = true;
    }),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        settled = true;
        resolve();
      }, 3000)
    ),
  ]);
}

export async function ensureDepotInitialized(uid: string, displayName?: string | null): Promise<void> {
  const depotPath = `depots/${uid}`;
  const depotRef = doc(db, 'depots', uid);

  let snap;
  try {
    snap = await getDoc(depotRef);
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('offline') || msg.includes('unavailable')) {
      throw new Error(
        'Sem conexão com a internet para carregar os dados iniciais. Conecte-se uma vez para habilitar o modo offline.'
      );
    }
    handleFirestoreError(error, OperationType.GET, depotPath);
  }

  if (snap.exists()) return;

  const firstName = sanitizeText((displayName || 'Central').split(' ')[0], 30);
  const depotName = sanitizeText(`Distribuidora ${firstName}`, FIELD_LIMITS.DEPOT_NAME);

  await executeFirestoreWrite(
    setDoc(depotRef, {
      ownerId: uid,
      name: depotName,
      currency: 'BRL' as CurrencyCode,
      deliveryFee: 8,
      drivers: ['Carlos Silva', 'Marcos Oliveira'],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    OperationType.CREATE,
    depotPath
  );

  const batch = writeBatch(db);
  for (const item of DEFAULT_CYLINDERS) {
    const cylRef = doc(db, 'depots', uid, 'cylinders', item.id);
    batch.set(cylRef, {
      ownerId: uid,
      code: item.code,
      name: item.name,
      weightKg: item.weightKg,
      fullCount: item.fullCount,
      emptyCount: item.emptyCount,
      salePrice: item.salePrice,
      shellPrice: item.shellPrice,
      costPrice: item.costPrice,
      minStock: item.minStock,
      updatedAt: serverTimestamp(),
    });
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.WRITE,
    `depots/${uid}/cylinders`
  );
}

export interface CreateSaleInput {
  uid: string;
  cylinder: Cylinder;
  customer: Customer | null;
  walkInName: string;
  walkInPhone: string;
  deliveryAddress: string;
  saleMode: SaleMode;
  quantity: number;
  discount: number;
  deliveryFee: number;
  fulfillmentType: FulfillmentType;
  driverName: string;
  paymentMethod: PaymentMethod;
  notes: string;
}

export async function createSaleTransaction(input: CreateSaleInput): Promise<Sale> {
  const {
    uid,
    cylinder,
    customer,
    walkInName,
    walkInPhone,
    deliveryAddress,
    saleMode,
    quantity,
    discount,
    deliveryFee,
    fulfillmentType,
    driverName,
    paymentMethod,
    notes,
  } = input;

  const qty = Math.max(1, Math.min(500, Math.floor(quantity)));
  if (cylinder.fullCount < qty) {
    throw new Error(`Estoque insuficiente de ${cylinder.code}: apenas ${cylinder.fullCount} cheios disponíveis.`);
  }

  const unitPrice =
    saleMode === 'exchange' ? cylinder.salePrice : cylinder.salePrice + cylinder.shellPrice;
  const safeDiscount = clampNonNegative(discount, unitPrice * qty + deliveryFee);
  const safeDeliveryFee = fulfillmentType === 'delivery' ? clampNonNegative(deliveryFee, 100000) : 0;
  const totalAmount = clampNonNegative(unitPrice * qty + safeDeliveryFee - safeDiscount);

  const paymentStatus = paymentMethod === 'credit' ? 'pending' : 'paid';
  const deliveryStatus: DeliveryStatus = fulfillmentType === 'pickup' ? 'delivered' : 'pending';

  const saleRef = doc(collection(db, 'depots', uid, 'sales'));
  const cylRef = doc(db, 'depots', uid, 'cylinders', cylinder.id);
  const movementRef = doc(collection(db, 'depots', uid, 'stockMovements'));
  const orderNumber = generateOrderNumber();

  const salePayload = {
    ownerId: uid,
    orderNumber,
    customerId: customer ? customer.id : '',
    customerName: sanitizeText(customer ? customer.name : walkInName || 'Cliente Balcão', FIELD_LIMITS.CUSTOMER_NAME),
    customerPhone: sanitizeText(customer ? customer.phone : walkInPhone, FIELD_LIMITS.PHONE),
    deliveryAddress: sanitizeText(
      fulfillmentType === 'pickup' ? 'Retirada no Balcão' : deliveryAddress || customer?.address || '',
      FIELD_LIMITS.ADDRESS
    ),
    cylinderId: cylinder.id,
    cylinderCode: sanitizeText(cylinder.code, FIELD_LIMITS.CYLINDER_CODE),
    saleMode,
    quantity: qty,
    unitPrice,
    deliveryFee: safeDeliveryFee,
    discount: safeDiscount,
    totalAmount,
    unitCost: cylinder.costPrice,
    fulfillmentType,
    driverName: sanitizeText(fulfillmentType === 'delivery' ? driverName : '', FIELD_LIMITS.DRIVER_NAME),
    paymentMethod,
    paymentStatus,
    deliveryStatus,
    notes: sanitizeText(notes, FIELD_LIMITS.NOTES),
  } as const;

  const batch = writeBatch(db);

  batch.set(saleRef, {
    ...salePayload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const emptyDelta = saleMode === 'exchange' ? qty : 0;
  batch.update(cylRef, {
    fullCount: cylinder.fullCount - qty,
    emptyCount: cylinder.emptyCount + emptyDelta,
    updatedAt: serverTimestamp(),
  });

  batch.set(movementRef, {
    ownerId: uid,
    cylinderId: cylinder.id,
    cylinderCode: sanitizeText(cylinder.code, FIELD_LIMITS.CYLINDER_CODE),
    movementType: 'sale' as MovementType,
    fullDelta: -qty,
    emptyDelta,
    note: sanitizeText(`Pedido ${orderNumber} (${saleMode === 'exchange' ? 'Troca' : 'Casco novo'})`, FIELD_LIMITS.MOVEMENT_NOTE),
    createdAt: serverTimestamp(),
  });

  if (customer) {
    const custRef = doc(db, 'depots', uid, 'customers', customer.id);
    batch.update(custRef, {
      totalOrders: customer.totalOrders + 1,
      totalSpent: clampNonNegative(customer.totalSpent + totalAmount),
      creditBalance:
        paymentStatus === 'pending'
          ? clampNonNegative(customer.creditBalance + totalAmount)
          : customer.creditBalance,
      updatedAt: serverTimestamp(),
    });
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.WRITE,
    `depots/${uid}/sales/${saleRef.id}`
  );

  const nowTs = Timestamp.now();
  return {
    id: saleRef.id,
    ...salePayload,
    createdAt: nowTs,
    updatedAt: nowTs,
  };
}

export async function updateSaleDelivery(
  uid: string,
  sale: Sale,
  nextStatus: DeliveryStatus,
  driverName: string,
  cylinder?: Cylinder,
  customer?: Customer
): Promise<void> {
  const saleRef = doc(db, 'depots', uid, 'sales', sale.id);
  const batch = writeBatch(db);

  batch.update(saleRef, {
    deliveryStatus: nextStatus,
    driverName: sanitizeText(driverName, FIELD_LIMITS.DRIVER_NAME),
    updatedAt: serverTimestamp(),
  });

  if (nextStatus === 'cancelled' && cylinder) {
    const cylRef = doc(db, 'depots', uid, 'cylinders', cylinder.id);
    const emptyRestore = sale.saleMode === 'exchange' ? -Math.min(cylinder.emptyCount, sale.quantity) : 0;

    batch.update(cylRef, {
      fullCount: cylinder.fullCount + sale.quantity,
      emptyCount: Math.max(0, cylinder.emptyCount + emptyRestore),
      updatedAt: serverTimestamp(),
    });

    const movementRef = doc(collection(db, 'depots', uid, 'stockMovements'));
    batch.set(movementRef, {
      ownerId: uid,
      cylinderId: cylinder.id,
      cylinderCode: sanitizeText(cylinder.code, FIELD_LIMITS.CYLINDER_CODE),
      movementType: 'cancel_restore' as MovementType,
      fullDelta: sale.quantity,
      emptyDelta: emptyRestore,
      note: sanitizeText(`Estorno do pedido ${sale.orderNumber}`, FIELD_LIMITS.MOVEMENT_NOTE),
      createdAt: serverTimestamp(),
    });

    if (customer && sale.paymentStatus === 'pending') {
      const custRef = doc(db, 'depots', uid, 'customers', customer.id);
      batch.update(custRef, {
        creditBalance: Math.max(0, clampNonNegative(customer.creditBalance - sale.totalAmount)),
        updatedAt: serverTimestamp(),
      });
    }
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.UPDATE,
    `depots/${uid}/sales/${sale.id}`
  );
}

export async function dispatchSalesRouteBatch(
  uid: string,
  salesToDispatch: Sale[],
  driverName: string
): Promise<void> {
  const pending = salesToDispatch.filter((s) => s.deliveryStatus === 'pending');
  if (pending.length === 0) return;

  const cleanDriver = sanitizeText(driverName, FIELD_LIMITS.DRIVER_NAME);
  const batch = writeBatch(db);

  for (const sale of pending) {
    const saleRef = doc(db, 'depots', uid, 'sales', sale.id);
    batch.update(saleRef, {
      deliveryStatus: 'in_route' as DeliveryStatus,
      driverName: cleanDriver || sanitizeText(sale.driverName, FIELD_LIMITS.DRIVER_NAME),
      updatedAt: serverTimestamp(),
    });
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.UPDATE,
    `depots/${uid}/sales`
  );
}

export async function markSalePaid(uid: string, sale: Sale, customer?: Customer): Promise<void> {
  const saleRef = doc(db, 'depots', uid, 'sales', sale.id);
  const batch = writeBatch(db);

  batch.update(saleRef, {
    paymentStatus: 'paid',
    updatedAt: serverTimestamp(),
  });

  if (customer && customer.creditBalance > 0) {
    const custRef = doc(db, 'depots', uid, 'customers', customer.id);
    batch.update(custRef, {
      creditBalance: Math.max(0, clampNonNegative(customer.creditBalance - sale.totalAmount)),
      updatedAt: serverTimestamp(),
    });
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.UPDATE,
    `depots/${uid}/sales/${sale.id}`
  );
}

export async function adjustCylinderStock(
  uid: string,
  cylinder: Cylinder,
  movementType: 'restock' | 'return_empty' | 'adjustment',
  fullDelta: number,
  emptyDelta: number,
  note: string
): Promise<void> {
  const nextFull = Math.max(0, cylinder.fullCount + fullDelta);
  const nextEmpty = Math.max(0, cylinder.emptyCount + emptyDelta);

  const batch = writeBatch(db);
  const cylRef = doc(db, 'depots', uid, 'cylinders', cylinder.id);
  const movementRef = doc(collection(db, 'depots', uid, 'stockMovements'));

  batch.update(cylRef, {
    fullCount: nextFull,
    emptyCount: nextEmpty,
    updatedAt: serverTimestamp(),
  });

  batch.set(movementRef, {
    ownerId: uid,
    cylinderId: cylinder.id,
    cylinderCode: sanitizeText(cylinder.code, FIELD_LIMITS.CYLINDER_CODE),
    movementType,
    fullDelta: nextFull - cylinder.fullCount,
    emptyDelta: nextEmpty - cylinder.emptyCount,
    note: sanitizeText(note || 'Movimentação manual', FIELD_LIMITS.MOVEMENT_NOTE),
    createdAt: serverTimestamp(),
  });

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.UPDATE,
    `depots/${uid}/cylinders/${cylinder.id}`
  );
}

export async function updateCylinderCatalog(
  uid: string,
  cylinderId: string,
  payload: {
    code: string;
    name: string;
    weightKg: number;
    salePrice: number;
    shellPrice: number;
    costPrice: number;
    minStock: number;
    imageUrl?: string;
  }
): Promise<void> {
  const cylRef = doc(db, 'depots', uid, 'cylinders', cylinderId);
  await executeFirestoreWrite(
    updateDoc(cylRef, {
      code: sanitizeText(payload.code, FIELD_LIMITS.CYLINDER_CODE),
      name: sanitizeText(payload.name, FIELD_LIMITS.CYLINDER_NAME),
      weightKg: Math.max(1, clampNonNegative(payload.weightKg, 1000)),
      salePrice: clampNonNegative(payload.salePrice, 1000000),
      shellPrice: clampNonNegative(payload.shellPrice, 1000000),
      costPrice: clampNonNegative(payload.costPrice, 1000000),
      minStock: Math.floor(clampNonNegative(payload.minStock, 10000)),
      imageUrl: sanitizeText(payload.imageUrl || '', FIELD_LIMITS.IMAGE_URL),
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${uid}/cylinders/${cylinderId}`
  );
}

export async function createCylinder(
  uid: string,
  payload: {
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
  }
): Promise<string> {
  const cylRef = doc(collection(db, 'depots', uid, 'cylinders'));
  const cleanCode = sanitizeText(payload.code, FIELD_LIMITS.CYLINDER_CODE);
  const fullCount = Math.floor(clampNonNegative(payload.fullCount, 100000));
  const emptyCount = Math.floor(clampNonNegative(payload.emptyCount, 100000));

  await executeFirestoreWrite(
    setDoc(cylRef, {
      ownerId: uid,
      code: cleanCode,
      name: sanitizeText(payload.name, FIELD_LIMITS.CYLINDER_NAME),
      weightKg: Math.max(0.5, clampNonNegative(payload.weightKg, 1000)),
      fullCount,
      emptyCount,
      salePrice: clampNonNegative(payload.salePrice, 1000000),
      shellPrice: clampNonNegative(payload.shellPrice, 1000000),
      costPrice: clampNonNegative(payload.costPrice, 1000000),
      minStock: Math.floor(clampNonNegative(payload.minStock, 10000)),
      imageUrl: sanitizeText(payload.imageUrl || '', FIELD_LIMITS.IMAGE_URL),
      updatedAt: serverTimestamp(),
    }),
    OperationType.CREATE,
    `depots/${uid}/cylinders/${cylRef.id}`
  );

  if (fullCount > 0 || emptyCount > 0) {
    const movementRef = doc(collection(db, 'depots', uid, 'stockMovements'));
    await executeFirestoreWrite(
      setDoc(movementRef, {
        ownerId: uid,
        cylinderId: cylRef.id,
        cylinderCode: cleanCode,
        movementType: 'restock' as MovementType,
        fullDelta: fullCount,
        emptyDelta: emptyCount,
        note: sanitizeText(`Estoque inicial de ${cleanCode}`, FIELD_LIMITS.MOVEMENT_NOTE),
        createdAt: serverTimestamp(),
      }),
      OperationType.CREATE,
      `depots/${uid}/stockMovements/${movementRef.id}`
    );
  }

  return cylRef.id;
}

export async function updateCylindersMinStock(
  uid: string,
  updates: { cylinderId: string; minStock: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  const batch = writeBatch(db);
  for (const item of updates) {
    const cylRef = doc(db, 'depots', uid, 'cylinders', item.cylinderId);
    batch.update(cylRef, {
      minStock: Math.floor(clampNonNegative(item.minStock, 10000)),
      updatedAt: serverTimestamp(),
    });
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.UPDATE,
    `depots/${uid}/cylinders`
  );
}

export async function createCustomer(
  uid: string,
  payload: { name: string; phone: string; address: string; neighborhood: string; notes: string }
): Promise<string> {
  const ref = doc(collection(db, 'depots', uid, 'customers'));
  await executeFirestoreWrite(
    setDoc(ref, {
      ownerId: uid,
      name: sanitizeText(payload.name, FIELD_LIMITS.CUSTOMER_NAME),
      phone: sanitizeText(payload.phone, FIELD_LIMITS.PHONE),
      address: sanitizeText(payload.address, FIELD_LIMITS.ADDRESS),
      neighborhood: sanitizeText(payload.neighborhood, FIELD_LIMITS.NEIGHBORHOOD),
      notes: sanitizeText(payload.notes, FIELD_LIMITS.NOTES),
      totalOrders: 0,
      totalSpent: 0,
      creditBalance: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    OperationType.CREATE,
    `depots/${uid}/customers/${ref.id}`
  );
  return ref.id;
}

export async function updateCustomerProfile(
  uid: string,
  customerId: string,
  payload: { name: string; phone: string; address: string; neighborhood: string; notes: string }
): Promise<void> {
  const ref = doc(db, 'depots', uid, 'customers', customerId);
  await executeFirestoreWrite(
    updateDoc(ref, {
      name: sanitizeText(payload.name, FIELD_LIMITS.CUSTOMER_NAME),
      phone: sanitizeText(payload.phone, FIELD_LIMITS.PHONE),
      address: sanitizeText(payload.address, FIELD_LIMITS.ADDRESS),
      neighborhood: sanitizeText(payload.neighborhood, FIELD_LIMITS.NEIGHBORHOOD),
      notes: sanitizeText(payload.notes, FIELD_LIMITS.NOTES),
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${uid}/customers/${customerId}`
  );
}

export async function settleCustomerCredit(uid: string, customer: Customer, paidAmount: number): Promise<void> {
  const ref = doc(db, 'depots', uid, 'customers', customer.id);
  const nextBalance = Math.max(0, clampNonNegative(customer.creditBalance - paidAmount));
  await executeFirestoreWrite(
    updateDoc(ref, {
      creditBalance: nextBalance,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${uid}/customers/${customer.id}`
  );
}

export async function removeCustomer(uid: string, customerId: string): Promise<void> {
  const ref = doc(db, 'depots', uid, 'customers', customerId);
  await executeFirestoreWrite(
    deleteDoc(ref),
    OperationType.DELETE,
    `depots/${uid}/customers/${customerId}`
  );
}

export async function createExpense(
  uid: string,
  payload: { category: ExpenseCategory; description: string; amount: number }
): Promise<void> {
  const ref = doc(collection(db, 'depots', uid, 'expenses'));
  const amount = Math.max(0.01, clampNonNegative(payload.amount, 100000000));
  await executeFirestoreWrite(
    setDoc(ref, {
      ownerId: uid,
      category: payload.category,
      description: sanitizeText(payload.description, FIELD_LIMITS.EXPENSE_DESC),
      amount,
      createdAt: serverTimestamp(),
    }),
    OperationType.CREATE,
    `depots/${uid}/expenses/${ref.id}`
  );
}

export async function removeExpense(uid: string, expenseId: string): Promise<void> {
  const ref = doc(db, 'depots', uid, 'expenses', expenseId);
  await executeFirestoreWrite(
    deleteDoc(ref),
    OperationType.DELETE,
    `depots/${uid}/expenses/${expenseId}`
  );
}

export async function updateDepotSettings(
  uid: string,
  payload: { name: string; currency: CurrencyCode; deliveryFee: number; drivers: string[] }
): Promise<void> {
  const ref = doc(db, 'depots', uid);
  const cleanDrivers = payload.drivers
    .map((d) => sanitizeText(d, FIELD_LIMITS.DRIVER_NAME))
    .filter(Boolean)
    .slice(0, FIELD_LIMITS.MAX_DRIVERS);

  await executeFirestoreWrite(
    updateDoc(ref, {
      name: sanitizeText(payload.name, FIELD_LIMITS.DEPOT_NAME),
      currency: payload.currency,
      deliveryFee: clampNonNegative(payload.deliveryFee, 10000),
      drivers: cleanDrivers,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${uid}`
  );
}
