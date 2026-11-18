import {
  collection,
  deleteDoc,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  query,
  type QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { clampNonNegative, generateOrderNumber, sanitizeText } from '../lib/formatters';
import {
  type CurrencyCode,
  type Customer,
  type Cylinder,
  type Depot,
  type DepotMember,
  type DeliveryStatus,
  type Expense,
  type ExpenseCategory,
  FIELD_LIMITS,
  FULL_ADMIN_PERMISSIONS,
  type FulfillmentType,
  LEGACY_MEMBER_PERMISSIONS,
  type MemberPermissions,
  type MemberRole,
  type MovementType,
  normalizePermissions,
  type PaymentMethod,
  type PaymentStatus,
  type Sale,
  type SaleMode,
  type StockMovement,
} from '../types/gas';

const depotMembersCache = new Map<string, string[]>();

export function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase().slice(0, FIELD_LIMITS.EMAIL);
}

export function setDepotMemberEmailsContext(depotId: string, emails?: string[]): void {
  const clean = Array.from(
    new Set((emails ?? []).map((e) => normalizeEmail(e)).filter(Boolean))
  ).slice(0, FIELD_LIMITS.MAX_MEMBER_EMAILS);
  if (clean.length > 0) {
    depotMembersCache.set(depotId, clean);
  }
}

function getDepotMemberEmails(depotId: string): string[] {
  const cached = depotMembersCache.get(depotId);
  if (cached && cached.length > 0) return cached;
  const currentEmail = normalizeEmail(auth.currentUser?.email);
  return currentEmail ? [currentEmail] : [];
}

function getActorUid(fallbackDepotId: string): string {
  return auth.currentUser?.uid || fallbackDepotId;
}

function buildAccessFields(depotId: string): { ownerId: string; memberEmails?: string[] } {
  const memberEmails = getDepotMemberEmails(depotId);
  return {
    ownerId: getActorUid(depotId),
    ...(memberEmails.length > 0 ? { memberEmails } : {}),
  };
}

function stringArraysEqual(a: unknown, b: string[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toSafeOccurredAtTimestamp(date?: Date): Timestamp | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  const maxAllowedMs = Date.now() - 30_000;
  const clamped = date.getTime() > maxAllowedMs ? new Date(maxAllowedMs) : date;
  return Timestamp.fromDate(clamped);
}

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

const SUBCOLLECTIONS_WITH_UPDATED_AT = new Set(['cylinders', 'customers', 'sales', 'members']);

export function emailToMemberDocId(email: string): string {
  const clean = normalizeEmail(email);
  const slug = clean.replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'user';
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
  }
  return `m_${slug}_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function syncDepotSubcollectionsMemberEmails(
  depotId: string,
  ownerUid: string,
  queryEmail: string,
  targetEmails: string[]
): Promise<void> {
  if (targetEmails.length === 0) return;

  const subcollections = [
    'cylinders',
    'customers',
    'sales',
    'stockMovements',
    'expenses',
    'members',
  ] as const;
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const cleanQueryEmail = normalizeEmail(queryEmail);

  for (const colName of subcollections) {
    const colRef = collection(db, 'depots', depotId, colName);
    const docsMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();

    try {
      const ownerSnap = await getDocs(query(colRef, where('ownerId', '==', ownerUid)));
      for (const d of ownerSnap.docs) {
        docsMap.set(d.id, d);
      }
      if (cleanQueryEmail) {
        const memberSnap = await getDocs(
          query(colRef, where('memberEmails', 'array-contains', cleanQueryEmail))
        );
        for (const d of memberSnap.docs) {
          docsMap.set(d.id, d);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `depots/${depotId}/${colName}`);
    }

    const withUpdatedAt = SUBCOLLECTIONS_WITH_UPDATED_AT.has(colName);
    for (const d of docsMap.values()) {
      const existingEmails = d.data().memberEmails;
      if (!stringArraysEqual(existingEmails, targetEmails)) {
        const docRef = doc(db, 'depots', depotId, colName, d.id);
        ops.push((b) =>
          b.update(docRef, {
            memberEmails: targetEmails,
            ...(withUpdatedAt ? { updatedAt: serverTimestamp() } : {}),
          })
        );
      }
    }
  }

  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK_SIZE)) {
      op(batch);
    }
    await executeFirestoreWrite(
      batch.commit(),
      OperationType.UPDATE,
      `depots/${depotId}`
    );
  }
}

export async function updateDepotMemberEmails(
  depotId: string,
  ownerUid: string,
  ownerEmail: string,
  rawEmails: string[]
): Promise<string[]> {
  const cleanOwnerEmail = normalizeEmail(ownerEmail);
  const cleanEmails = Array.from(
    new Set([cleanOwnerEmail, ...rawEmails.map((e) => normalizeEmail(e))].filter(Boolean))
  ).slice(0, FIELD_LIMITS.MAX_MEMBER_EMAILS);

  const depotRef = doc(db, 'depots', depotId);
  await executeFirestoreWrite(
    updateDoc(depotRef, {
      memberEmails: cleanEmails,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${depotId}`
  );

  setDepotMemberEmailsContext(depotId, cleanEmails);
  await syncDepotSubcollectionsMemberEmails(depotId, ownerUid, cleanOwnerEmail, cleanEmails);
  return cleanEmails;
}

function buildSanitizedMemberPermissionsMap(
  depot: Depot,
  emails: string[],
  overrides?: Record<string, MemberPermissions>
): Record<string, MemberPermissions> {
  const next: Record<string, MemberPermissions> = {};
  const existingMap = depot.memberPermissions ?? {};
  const ownerEmail = normalizeEmail(depot.memberEmails?.[0]);

  for (const email of emails) {
    const clean = normalizeEmail(email);
    if (!clean) continue;
    if (overrides?.[clean]) {
      next[clean] = normalizePermissions(overrides[clean], LEGACY_MEMBER_PERMISSIONS);
    } else if (existingMap[clean]) {
      next[clean] = normalizePermissions(existingMap[clean], LEGACY_MEMBER_PERMISSIONS);
    } else if (clean === ownerEmail) {
      next[clean] = { ...FULL_ADMIN_PERMISSIONS };
    }
  }
  return next;
}

export async function inviteOrUpdateDepotMember(input: {
  depotId: string;
  depot: Depot;
  actorEmail: string;
  email: string;
  displayName: string;
  role: MemberRole;
  permissions: MemberPermissions;
  existingMembers: DepotMember[];
}): Promise<void> {
  const { depotId, depot, actorEmail, email, displayName, role, permissions, existingMembers } = input;
  const targetEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    throw new Error('Informe um endereço de e-mail válido.');
  }

  const cleanActorEmail = normalizeEmail(actorEmail);
  const existingList = (depot.memberEmails ?? []).map((e) => normalizeEmail(e)).filter(Boolean);
  const ownerEmail = existingList[0] || cleanActorEmail;
  const nextEmails = Array.from(new Set([ownerEmail, ...existingList, targetEmail])).slice(
    0,
    FIELD_LIMITS.MAX_MEMBER_EMAILS
  );

  if (!nextEmails.includes(targetEmail)) {
    throw new Error(`Limite máximo de ${FIELD_LIMITS.MAX_MEMBER_EMAILS} usuários atingido.`);
  }

  const isTargetOwner = targetEmail === ownerEmail;
  const effectivePermissions: MemberPermissions = isTargetOwner
    ? { ...FULL_ADMIN_PERMISSIONS }
    : normalizePermissions(permissions, LEGACY_MEMBER_PERMISSIONS);
  const effectiveRole: MemberRole = isTargetOwner ? 'admin' : role;

  const nextMemberPermissions = buildSanitizedMemberPermissionsMap(depot, nextEmails, {
    [targetEmail]: effectivePermissions,
  });

  const depotRef = doc(db, 'depots', depotId);
  await executeFirestoreWrite(
    updateDoc(depotRef, {
      memberEmails: nextEmails,
      memberPermissions: nextMemberPermissions,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${depotId}`
  );

  setDepotMemberEmailsContext(depotId, nextEmails);

  const existingMember = existingMembers.find((m) => normalizeEmail(m.email) === targetEmail);
  const memberId = existingMember?.id || emailToMemberDocId(targetEmail);
  const memberRef = doc(db, 'depots', depotId, 'members', memberId);
  const cleanName = sanitizeText(displayName, FIELD_LIMITS.CUSTOMER_NAME);

  if (existingMember) {
    await executeFirestoreWrite(
      updateDoc(memberRef, {
        memberEmails: nextEmails,
        displayName: cleanName,
        role: effectiveRole,
        permissions: effectivePermissions,
        updatedAt: serverTimestamp(),
      }),
      OperationType.UPDATE,
      `depots/${depotId}/members/${memberId}`
    );
  } else {
    await executeFirestoreWrite(
      setDoc(memberRef, {
        ownerId: getActorUid(depotId),
        memberEmails: nextEmails,
        email: targetEmail,
        displayName: cleanName,
        role: effectiveRole,
        permissions: effectivePermissions,
        status: isTargetOwner ? 'active' : 'invited',
        joinedUid: isTargetOwner ? depot.ownerId : '',
        invitedByEmail: sanitizeText(cleanActorEmail, FIELD_LIMITS.EMAIL),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      OperationType.CREATE,
      `depots/${depotId}/members/${memberId}`
    );
  }

  const queryEmail = cleanActorEmail || ownerEmail;
  await syncDepotSubcollectionsMemberEmails(depotId, depot.ownerId, queryEmail, nextEmails);
}

export async function removeDepotMember(input: {
  depotId: string;
  depot: Depot;
  actorEmail: string;
  emailToRemove: string;
  existingMembers: DepotMember[];
}): Promise<void> {
  const { depotId, depot, actorEmail, emailToRemove, existingMembers } = input;
  const targetEmail = normalizeEmail(emailToRemove);
  const cleanActorEmail = normalizeEmail(actorEmail);
  const existingList = (depot.memberEmails ?? []).map((e) => normalizeEmail(e)).filter(Boolean);
  const ownerEmail = existingList[0] || '';

  if (targetEmail === ownerEmail) {
    throw new Error('O administrador principal da distribuidora não pode ser removido.');
  }
  if (targetEmail === cleanActorEmail) {
    throw new Error('Você não pode remover o próprio acesso enquanto está conectado.');
  }

  const nextEmails = existingList.filter((e) => e !== targetEmail);
  const nextMemberPermissions = buildSanitizedMemberPermissionsMap(depot, nextEmails);

  const existingMember = existingMembers.find((m) => normalizeEmail(m.email) === targetEmail);
  if (existingMember) {
    await executeFirestoreWrite(
      deleteDoc(doc(db, 'depots', depotId, 'members', existingMember.id)),
      OperationType.DELETE,
      `depots/${depotId}/members/${existingMember.id}`
    );
  }

  await executeFirestoreWrite(
    updateDoc(doc(db, 'depots', depotId), {
      memberEmails: nextEmails,
      memberPermissions: nextMemberPermissions,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${depotId}`
  );

  setDepotMemberEmailsContext(depotId, nextEmails);
  const queryEmail = cleanActorEmail || ownerEmail;
  await syncDepotSubcollectionsMemberEmails(depotId, depot.ownerId, queryEmail, nextEmails);
}

export async function activateSelfMemberRecord(
  depotId: string,
  userUid: string,
  userEmail: string,
  displayName: string,
  existingMembers: DepotMember[]
): Promise<void> {
  const cleanEmail = normalizeEmail(userEmail);
  if (!cleanEmail) return;
  const existing = existingMembers.find((m) => normalizeEmail(m.email) === cleanEmail);
  if (!existing) return;
  if (existing.status === 'active' && existing.joinedUid === userUid) return;

  const memberRef = doc(db, 'depots', depotId, 'members', existing.id);
  const nextName =
    existing.displayName.trim() || sanitizeText(displayName, FIELD_LIMITS.CUSTOMER_NAME);
  await updateDoc(memberRef, {
    status: 'active',
    joinedUid: userUid,
    displayName: nextName,
    updatedAt: serverTimestamp(),
  }).catch(() => {
    // Best-effort self-activation; do not interrupt session if transient error
  });
}

export async function ensureDepotInitialized(
  uid: string,
  displayName?: string | null,
  email?: string | null
): Promise<{ activeDepotId: string; availableDepots: Depot[] }> {
  const userEmail = normalizeEmail(email);
  const depotPath = `depots/${uid}`;
  const depotRef = doc(db, 'depots', uid);

  const depotMap = new Map<string, Depot>();

  // 1. Discover any shared depots where this account is an authorized member
  if (userEmail) {
    try {
      const sharedSnap = await getDocs(
        query(collection(db, 'depots'), where('memberEmails', 'array-contains', userEmail))
      );
      for (const d of sharedSnap.docs) {
        const depotData = {
          id: d.id,
          ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Depot, 'id'>),
        };
        depotMap.set(d.id, depotData);
        setDepotMemberEmailsContext(d.id, depotData.memberEmails);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : '';
      if (msg.includes('offline') || msg.includes('unavailable')) {
        throw new Error(
          'Sem conexão com a internet para carregar os dados iniciais. Conecte-se uma vez para habilitar o modo offline.'
        );
      }
      handleFirestoreError(error, OperationType.LIST, 'depots');
    }
  }

  // 2. Check user's own depot
  let ownSnap;
  try {
    ownSnap = await getDoc(depotRef);
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('offline') || msg.includes('unavailable')) {
      throw new Error(
        'Sem conexão com a internet para carregar os dados iniciais. Conecte-se uma vez para habilitar o modo offline.'
      );
    }
    handleFirestoreError(error, OperationType.GET, depotPath);
  }

  if (ownSnap.exists()) {
    const ownDepot = {
      id: ownSnap.id,
      ...(ownSnap.data({ serverTimestamps: 'estimate' }) as Omit<Depot, 'id'>),
    };
    const existingEmails = (ownDepot.memberEmails ?? []).map((e) => normalizeEmail(e)).filter(Boolean);
    const needsUpgrade = userEmail && !existingEmails.includes(userEmail);

    if (needsUpgrade) {
      const upgradedEmails = Array.from(new Set([userEmail, ...existingEmails])).slice(
        0,
        FIELD_LIMITS.MAX_MEMBER_EMAILS
      );
      await updateDepotMemberEmails(uid, uid, userEmail, upgradedEmails);
      ownDepot.memberEmails = upgradedEmails;
    } else if (existingEmails.length > 0 && userEmail) {
      // Ensure any legacy subcollection docs missing memberEmails are backfilled once
      await syncDepotSubcollectionsMemberEmails(uid, uid, userEmail, existingEmails);
    }

    setDepotMemberEmailsContext(ownDepot.id, ownDepot.memberEmails);
    depotMap.set(ownDepot.id, ownDepot);
  }

  const hasSharedDepot = Array.from(depotMap.values()).some((d) => d.ownerId !== uid);

  // 3. Only create a personal depot if the user neither owns one nor belongs to a shared depot yet
  if (!ownSnap.exists() && !hasSharedDepot) {
    const firstName = sanitizeText((displayName || 'Central').split(' ')[0], 30);
    const depotName = sanitizeText(`Distribuidora ${firstName}`, FIELD_LIMITS.DEPOT_NAME);
    const initialMemberEmails = userEmail ? [userEmail] : [];

    await executeFirestoreWrite(
      setDoc(depotRef, {
        ownerId: uid,
        ...(initialMemberEmails.length > 0 ? { memberEmails: initialMemberEmails } : {}),
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
        ...(initialMemberEmails.length > 0 ? { memberEmails: initialMemberEmails } : {}),
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

    setDepotMemberEmailsContext(uid, initialMemberEmails);
    depotMap.set(uid, {
      id: uid,
      ownerId: uid,
      memberEmails: initialMemberEmails,
      name: depotName,
      currency: 'BRL',
      deliveryFee: 8,
      drivers: ['Carlos Silva', 'Marcos Oliveira'],
    });
  }

  const availableDepots = Array.from(depotMap.values());
  const savedChoice =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(`lucygas_active_depot_${uid}`)
      : null;

  let activeDepotId = uid;
  if (savedChoice && depotMap.has(savedChoice)) {
    activeDepotId = savedChoice;
  } else {
    const shared = availableDepots.find((d) => d.ownerId !== uid);
    if (shared) {
      activeDepotId = shared.id;
    } else if (availableDepots[0]) {
      activeDepotId = availableDepots[0].id;
    }
  }

  return { activeDepotId, availableDepots };
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
  occurredAt?: Date;
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
    occurredAt,
  } = input;

  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw new Error('A quantidade da venda deve ser um número inteiro entre 1 e 500.');
  }
  if (!Number.isFinite(discount) || discount < 0 || discount > 1000000) {
    throw new Error('O desconto não pode ser negativo.');
  }
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0 || deliveryFee > 100000) {
    throw new Error('A taxa de entrega não pode ser negativa.');
  }
  if (!customer && !walkInName.trim()) {
    throw new Error('Informe o nome do cliente para concluir a venda.');
  }
  if (fulfillmentType === 'delivery' && !deliveryAddress.trim()) {
    throw new Error('Informe o endereço de entrega para concluir o pedido.');
  }

  const qty = quantity;
  if (cylinder.fullCount < qty) {
    throw new Error(`Estoque insuficiente de ${cylinder.code}: apenas ${cylinder.fullCount} cheios disponíveis.`);
  }

  const unitPrice =
    saleMode === 'exchange' ? cylinder.salePrice : cylinder.salePrice + cylinder.shellPrice;
  const safeDeliveryFee = fulfillmentType === 'delivery' ? clampNonNegative(deliveryFee, 100000) : 0;
  if (discount > unitPrice * qty + safeDeliveryFee) {
    throw new Error('O desconto não pode ser maior que o valor total da venda.');
  }
  const safeDiscount = clampNonNegative(discount, unitPrice * qty + safeDeliveryFee);
  const totalAmount = clampNonNegative(unitPrice * qty + safeDeliveryFee - safeDiscount);

  const paymentStatus: PaymentStatus = paymentMethod === 'credit' ? 'pending' : 'paid';
  const deliveryStatus: DeliveryStatus = fulfillmentType === 'pickup' ? 'delivered' : 'pending';

  const saleRef = doc(collection(db, 'depots', uid, 'sales'));
  const cylRef = doc(db, 'depots', uid, 'cylinders', cylinder.id);
  const movementRef = doc(collection(db, 'depots', uid, 'stockMovements'));
  const orderNumber = generateOrderNumber();

  const salePayload = {
    ...buildAccessFields(uid),
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
  };

  const batch = writeBatch(db);
  const occurredTs = toSafeOccurredAtTimestamp(occurredAt);

  batch.set(saleRef, {
    ...salePayload,
    ...(occurredTs ? { occurredAt: occurredTs } : {}),
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
    ...buildAccessFields(uid),
    cylinderId: cylinder.id,
    cylinderCode: sanitizeText(cylinder.code, FIELD_LIMITS.CYLINDER_CODE),
    movementType: 'sale' as MovementType,
    fullDelta: -qty,
    emptyDelta,
    note: sanitizeText(`Pedido ${orderNumber} (${saleMode === 'exchange' ? 'Troca' : 'Casco novo'})`, FIELD_LIMITS.MOVEMENT_NOTE),
    ...(occurredTs ? { occurredAt: occurredTs } : {}),
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
    ...(occurredTs ? { occurredAt: occurredTs } : {}),
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
      ...buildAccessFields(uid),
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
  note: string,
  occurredAt?: Date
): Promise<void> {
  if (!Number.isFinite(fullDelta) || !Number.isFinite(emptyDelta)) {
    throw new Error('Informe quantidades válidas para a movimentação de estoque.');
  }
  const nextFull = cylinder.fullCount + fullDelta;
  const nextEmpty = cylinder.emptyCount + emptyDelta;
  if (nextFull < 0 || nextEmpty < 0) {
    throw new Error('O saldo de botijões cheios ou vazios não pode ficar negativo.');
  }
  const occurredTs = toSafeOccurredAtTimestamp(occurredAt);

  const batch = writeBatch(db);
  const cylRef = doc(db, 'depots', uid, 'cylinders', cylinder.id);
  const movementRef = doc(collection(db, 'depots', uid, 'stockMovements'));

  batch.update(cylRef, {
    fullCount: nextFull,
    emptyCount: nextEmpty,
    updatedAt: serverTimestamp(),
  });

  batch.set(movementRef, {
    ...buildAccessFields(uid),
    cylinderId: cylinder.id,
    cylinderCode: sanitizeText(cylinder.code, FIELD_LIMITS.CYLINDER_CODE),
    movementType,
    fullDelta: nextFull - cylinder.fullCount,
    emptyDelta: nextEmpty - cylinder.emptyCount,
    note: sanitizeText(note || 'Movimentação manual', FIELD_LIMITS.MOVEMENT_NOTE),
    ...(occurredTs ? { occurredAt: occurredTs } : {}),
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
  const cleanCode = sanitizeText(payload.code, FIELD_LIMITS.CYLINDER_CODE);
  const cleanName = sanitizeText(payload.name, FIELD_LIMITS.CYLINDER_NAME);
  if (!cleanCode || !cleanName) {
    throw new Error('Código e descrição do produto são obrigatórios.');
  }
  if (!Number.isFinite(payload.weightKg) || payload.weightKg <= 0 || payload.weightKg > 1000) {
    throw new Error('O peso do botijão deve ser maior que zero e até 1.000 kg.');
  }
  if (!Number.isFinite(payload.salePrice) || payload.salePrice <= 0 || payload.salePrice > 1000000) {
    throw new Error('O preço de recarga deve ser maior que zero.');
  }
  if (
    !Number.isFinite(payload.shellPrice) ||
    payload.shellPrice < 0 ||
    !Number.isFinite(payload.costPrice) ||
    payload.costPrice < 0 ||
    !Number.isFinite(payload.minStock) ||
    payload.minStock < 0
  ) {
    throw new Error('Preços, custos e estoque mínimo não podem ser negativos.');
  }

  const cylRef = doc(db, 'depots', uid, 'cylinders', cylinderId);
  await executeFirestoreWrite(
    updateDoc(cylRef, {
      code: cleanCode,
      name: cleanName,
      weightKg: clampNonNegative(payload.weightKg, 1000),
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
  const cleanCode = sanitizeText(payload.code, FIELD_LIMITS.CYLINDER_CODE);
  const cleanName = sanitizeText(payload.name, FIELD_LIMITS.CYLINDER_NAME);
  if (!cleanCode || !cleanName) {
    throw new Error('Código e descrição do produto são obrigatórios.');
  }
  if (!Number.isFinite(payload.weightKg) || payload.weightKg <= 0 || payload.weightKg > 1000) {
    throw new Error('O peso do botijão deve ser maior que zero e até 1.000 kg.');
  }
  if (
    !Number.isFinite(payload.fullCount) ||
    payload.fullCount < 0 ||
    !Number.isFinite(payload.emptyCount) ||
    payload.emptyCount < 0
  ) {
    throw new Error('As quantidades iniciais não podem ser negativas.');
  }
  if (!Number.isFinite(payload.salePrice) || payload.salePrice <= 0 || payload.salePrice > 1000000) {
    throw new Error('O preço de recarga deve ser maior que zero.');
  }
  if (
    !Number.isFinite(payload.shellPrice) ||
    payload.shellPrice < 0 ||
    !Number.isFinite(payload.costPrice) ||
    payload.costPrice < 0 ||
    !Number.isFinite(payload.minStock) ||
    payload.minStock < 0
  ) {
    throw new Error('Preços, custos e estoque mínimo não podem ser negativos.');
  }

  const cylRef = doc(collection(db, 'depots', uid, 'cylinders'));
  const fullCount = Math.floor(clampNonNegative(payload.fullCount, 100000));
  const emptyCount = Math.floor(clampNonNegative(payload.emptyCount, 100000));

  await executeFirestoreWrite(
    setDoc(cylRef, {
      ...buildAccessFields(uid),
      code: cleanCode,
      name: cleanName,
      weightKg: clampNonNegative(payload.weightKg, 1000),
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
        ...buildAccessFields(uid),
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
  for (const item of updates) {
    if (!Number.isFinite(item.minStock) || item.minStock < 0 || item.minStock > 10000) {
      throw new Error('O estoque mínimo deve ser um número inteiro maior ou igual a zero.');
    }
  }
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
  const cleanName = sanitizeText(payload.name, FIELD_LIMITS.CUSTOMER_NAME);
  if (!cleanName) {
    throw new Error('O nome do cliente é obrigatório.');
  }
  const ref = doc(collection(db, 'depots', uid, 'customers'));
  await executeFirestoreWrite(
    setDoc(ref, {
      ...buildAccessFields(uid),
      name: cleanName,
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
  const cleanName = sanitizeText(payload.name, FIELD_LIMITS.CUSTOMER_NAME);
  if (!cleanName) {
    throw new Error('O nome do cliente é obrigatório.');
  }
  const ref = doc(db, 'depots', uid, 'customers', customerId);
  await executeFirestoreWrite(
    updateDoc(ref, {
      name: cleanName,
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
  if (!Number.isFinite(paidAmount) || paidAmount <= 0 || paidAmount > customer.creditBalance + 0.0001) {
    throw new Error('Informe um valor recebido válido entre 0,01 e o saldo devedor atual.');
  }
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
  payload: { category: ExpenseCategory; description: string; amount: number; occurredAt?: Date }
): Promise<void> {
  const cleanDesc = sanitizeText(payload.description, FIELD_LIMITS.EXPENSE_DESC);
  if (!cleanDesc) {
    throw new Error('A descrição da despesa é obrigatória.');
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0 || payload.amount > 100000000) {
    throw new Error('O valor da despesa deve ser maior que zero.');
  }
  const ref = doc(collection(db, 'depots', uid, 'expenses'));
  const amount = Math.max(0.01, clampNonNegative(payload.amount, 100000000));
  const occurredTs = toSafeOccurredAtTimestamp(payload.occurredAt);
  await executeFirestoreWrite(
    setDoc(ref, {
      ...buildAccessFields(uid),
      category: payload.category,
      description: cleanDesc,
      amount,
      ...(occurredTs ? { occurredAt: occurredTs } : {}),
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

export async function deleteSaleRecord(uid: string, saleId: string): Promise<void> {
  const ref = doc(db, 'depots', uid, 'sales', saleId);
  await executeFirestoreWrite(
    deleteDoc(ref),
    OperationType.DELETE,
    `depots/${uid}/sales/${saleId}`
  );
}

export async function updateDepotSettings(
  uid: string,
  payload: { name: string; currency: CurrencyCode; deliveryFee: number; drivers: string[] }
): Promise<void> {
  const cleanName = sanitizeText(payload.name, FIELD_LIMITS.DEPOT_NAME);
  if (!cleanName) {
    throw new Error('O nome da distribuidora é obrigatório.');
  }
  if (!Number.isFinite(payload.deliveryFee) || payload.deliveryFee < 0 || payload.deliveryFee > 10000) {
    throw new Error('A taxa padrão de entrega não pode ser negativa.');
  }
  const ref = doc(db, 'depots', uid);
  const cleanDrivers = payload.drivers
    .map((d) => sanitizeText(d, FIELD_LIMITS.DRIVER_NAME))
    .filter(Boolean)
    .slice(0, FIELD_LIMITS.MAX_DRIVERS);

  await executeFirestoreWrite(
    updateDoc(ref, {
      name: cleanName,
      currency: payload.currency,
      deliveryFee: clampNonNegative(payload.deliveryFee, 10000),
      drivers: cleanDrivers,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `depots/${uid}`
  );
}

export type HistoricalEventKind = 'sale' | 'restock' | 'acquisition';

export interface HistoricalInitialStockInput {
  code: string;
  fullCount: number;
  emptyCount: number;
}

export interface SavedHistoricalRowRecord {
  saleId?: string;
  movementId: string;
  cylinderId: string;
  fullDelta: number;
  emptyDelta: number;
}

export interface HistoricalLedgerEventInput {
  id: string;
  dateStr: string; // YYYY-MM-DD
  kind: HistoricalEventKind;
  cylinderCode: string;
  quantity: number;
  discount: number;
  note?: string;
  savedRecord?: SavedHistoricalRowRecord;
  dirtySinceSave?: boolean;
}

async function ensureCylindersExistForCodes(
  uid: string,
  existingCylinders: Cylinder[],
  codes: string[]
): Promise<Map<string, Cylinder>> {
  const cylinderByCode = new Map<string, Cylinder>();
  for (const c of existingCylinders) {
    cylinderByCode.set(c.code.trim().toUpperCase(), c);
  }

  const missingCodes = codes.filter((code) => code && !cylinderByCode.has(code));
  if (missingCodes.length > 0) {
    const createBatch = writeBatch(db);
    for (const code of missingCodes) {
      const weightMatch = code.match(/(\d+)/);
      const weightKg = weightMatch ? Math.max(1, Number(weightMatch[1])) : 11;
      const slug = code.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const cylId = slug || `cyl_${Date.now()}`;
      const cylRef = doc(db, 'depots', uid, 'cylinders', cylId);
      const created: Cylinder = {
        id: cylId,
        ...buildAccessFields(uid),
        code: sanitizeText(code, FIELD_LIMITS.CYLINDER_CODE),
        name: sanitizeText(`Botijão ${code} (${weightKg} kg)`, FIELD_LIMITS.CYLINDER_NAME),
        weightKg,
        fullCount: 0,
        emptyCount: 0,
        salePrice: 1000,
        shellPrice: 2000,
        costPrice: 750,
        minStock: 3,
      };
      createBatch.set(cylRef, {
        ...buildAccessFields(uid),
        code: created.code,
        name: created.name,
        weightKg: created.weightKg,
        fullCount: 0,
        emptyCount: 0,
        salePrice: created.salePrice,
        shellPrice: created.shellPrice,
        costPrice: created.costPrice,
        minStock: created.minStock,
        updatedAt: serverTimestamp(),
      });
      cylinderByCode.set(code, created);
    }
    await executeFirestoreWrite(
      createBatch.commit(),
      OperationType.CREATE,
      `depots/${uid}/cylinders`
    );
  }

  return cylinderByCode;
}

export async function saveInitialStockToFirestore(input: {
  uid: string;
  existingCylinders: Cylinder[];
  initialDateStr: string;
  initialStocks: HistoricalInitialStockInput[];
}): Promise<void> {
  const { uid, existingCylinders, initialDateStr, initialStocks } = input;
  const allCodes = Array.from(
    new Set(initialStocks.map((s) => s.code.trim().toUpperCase()))
  ).filter(Boolean);

  const cylinderByCode = await ensureCylindersExistForCodes(uid, existingCylinders, allCodes);
  const initBaseDate = new Date(`${initialDateStr}T08:00:00`);
  const initTs = toSafeOccurredAtTimestamp(initBaseDate) ?? Timestamp.now();

  const batch = writeBatch(db);
  for (const init of initialStocks) {
    const code = init.code.trim().toUpperCase();
    const cyl = cylinderByCode.get(code);
    if (!cyl) continue;
    const fullCount = Math.max(0, Math.floor(init.fullCount));
    const emptyCount = Math.max(0, Math.floor(init.emptyCount));
    batch.update(doc(db, 'depots', uid, 'cylinders', cyl.id), {
      fullCount,
      emptyCount,
      updatedAt: serverTimestamp(),
    });
    const movRef = doc(collection(db, 'depots', uid, 'stockMovements'));
    batch.set(movRef, {
      ...buildAccessFields(uid),
      cylinderId: cyl.id,
      cylinderCode: cyl.code,
      movementType: 'adjustment' as MovementType,
      fullDelta: fullCount,
      emptyDelta: emptyCount,
      note: sanitizeText(`Stock inicial (${initialDateStr})`, FIELD_LIMITS.MOVEMENT_NOTE),
      occurredAt: initTs,
      createdAt: serverTimestamp(),
    });
  }

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.WRITE,
    `depots/${uid}/cylinders`
  );
}

export async function saveSingleHistoricalEvent(input: {
  uid: string;
  existingCylinders: Cylinder[];
  event: HistoricalLedgerEventInput;
  seqIndex: number;
}): Promise<SavedHistoricalRowRecord> {
  const { uid, existingCylinders, event, seqIndex } = input;
  const code = event.cylinderCode.trim().toUpperCase();
  const cylinderByCode = await ensureCylindersExistForCodes(uid, existingCylinders, [code]);
  const cyl = cylinderByCode.get(code);
  if (!cyl) {
    throw new Error(`Botijão ${code} não encontrado.`);
  }

  const baseTime = new Date(`${event.dateStr}T09:00:00`);
  const eventTime = new Date(baseTime.getTime() + seqIndex * 15 * 60 * 1000);
  const occurredTs = toSafeOccurredAtTimestamp(eventTime) ?? Timestamp.now();
  const qty = Math.max(1, Math.floor(event.quantity));

  const batch = writeBatch(db);

  // Reverse previous saved record if user edited and re-saved the same row
  let baseFull = cyl.fullCount;
  let baseEmpty = cyl.emptyCount;
  const prev = event.savedRecord;
  if (prev) {
    if (prev.saleId) {
      batch.delete(doc(db, 'depots', uid, 'sales', prev.saleId));
    }
    if (prev.movementId) {
      batch.delete(doc(db, 'depots', uid, 'stockMovements', prev.movementId));
    }
    if (prev.cylinderId === cyl.id) {
      baseFull = Math.max(0, baseFull - prev.fullDelta);
      baseEmpty = Math.max(0, baseEmpty - prev.emptyDelta);
    } else {
      const prevCyl = existingCylinders.find((c) => c.id === prev.cylinderId);
      if (prevCyl) {
        batch.update(doc(db, 'depots', uid, 'cylinders', prevCyl.id), {
          fullCount: Math.max(0, prevCyl.fullCount - prev.fullDelta),
          emptyCount: Math.max(0, prevCyl.emptyCount - prev.emptyDelta),
          updatedAt: serverTimestamp(),
        });
      }
    }
  }

  let nextFull = baseFull;
  let nextEmpty = baseEmpty;
  let saleId: string | undefined;
  const movRef = doc(collection(db, 'depots', uid, 'stockMovements'));

  if (event.kind === 'sale') {
    nextFull = Math.max(0, baseFull - qty);
    nextEmpty = baseEmpty + qty;

    const unitPrice = cyl.salePrice;
    const safeDiscount = clampNonNegative(event.discount, unitPrice * qty);
    const totalAmount = clampNonNegative(unitPrice * qty - safeDiscount);
    const [, mm = '11', dd = '01'] = event.dateStr.split('-');
    const orderNumber = `HIST-${dd}${mm}-${String(seqIndex + 1).padStart(2, '0')}`;

    const saleRef = doc(collection(db, 'depots', uid, 'sales'));
    saleId = saleRef.id;

    batch.set(saleRef, {
      ...buildAccessFields(uid),
      orderNumber,
      customerId: '',
      customerName: 'Cliente Balcão',
      customerPhone: '',
      deliveryAddress: 'Retirada no Balcão',
      cylinderId: cyl.id,
      cylinderCode: cyl.code,
      saleMode: 'exchange' as SaleMode,
      quantity: qty,
      unitPrice,
      deliveryFee: 0,
      discount: safeDiscount,
      totalAmount,
      unitCost: cyl.costPrice,
      fulfillmentType: 'pickup' as FulfillmentType,
      driverName: '',
      paymentMethod: 'cash' as PaymentMethod,
      paymentStatus: 'paid',
      deliveryStatus: 'delivered',
      notes: sanitizeText(event.note || 'Histórico salvo', FIELD_LIMITS.NOTES),
      occurredAt: occurredTs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(movRef, {
      ...buildAccessFields(uid),
      cylinderId: cyl.id,
      cylinderCode: cyl.code,
      movementType: 'sale' as MovementType,
      fullDelta: nextFull - baseFull,
      emptyDelta: nextEmpty - baseEmpty,
      note: sanitizeText(`Pedido ${orderNumber} (Troca)`, FIELD_LIMITS.MOVEMENT_NOTE),
      occurredAt: occurredTs,
      createdAt: serverTimestamp(),
    });
  } else if (event.kind === 'restock') {
    const emptiesUsed = Math.min(baseEmpty, qty);
    nextFull = baseFull + qty;
    nextEmpty = baseEmpty - emptiesUsed;

    batch.set(movRef, {
      ...buildAccessFields(uid),
      cylinderId: cyl.id,
      cylinderCode: cyl.code,
      movementType: 'restock' as MovementType,
      fullDelta: nextFull - baseFull,
      emptyDelta: nextEmpty - baseEmpty,
      note: sanitizeText(event.note || `Reposição ${cyl.code} (${qty} un)`, FIELD_LIMITS.MOVEMENT_NOTE),
      occurredAt: occurredTs,
      createdAt: serverTimestamp(),
    });
  } else {
    nextFull = baseFull + qty;

    batch.set(movRef, {
      ...buildAccessFields(uid),
      cylinderId: cyl.id,
      cylinderCode: cyl.code,
      movementType: 'restock' as MovementType,
      fullDelta: nextFull - baseFull,
      emptyDelta: 0,
      note: sanitizeText(event.note || `Aquisição de ${qty} ${cyl.code} completo`, FIELD_LIMITS.MOVEMENT_NOTE),
      occurredAt: occurredTs,
      createdAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'depots', uid, 'cylinders', cyl.id), {
    fullCount: nextFull,
    emptyCount: nextEmpty,
    updatedAt: serverTimestamp(),
  });

  await executeFirestoreWrite(
    batch.commit(),
    OperationType.WRITE,
    `depots/${uid}/cylinders/${cyl.id}`
  );

  return {
    saleId,
    movementId: movRef.id,
    cylinderId: cyl.id,
    fullDelta: nextFull - baseFull,
    emptyDelta: nextEmpty - baseEmpty,
  };
}

export async function deleteSingleHistoricalEvent(input: {
  uid: string;
  existingCylinders: Cylinder[];
  savedRecord: SavedHistoricalRowRecord;
}): Promise<void> {
  const { uid, existingCylinders, savedRecord } = input;
  const batch = writeBatch(db);
  if (savedRecord.saleId) {
    batch.delete(doc(db, 'depots', uid, 'sales', savedRecord.saleId));
  }
  if (savedRecord.movementId) {
    batch.delete(doc(db, 'depots', uid, 'stockMovements', savedRecord.movementId));
  }
  const cyl = existingCylinders.find((c) => c.id === savedRecord.cylinderId);
  if (cyl) {
    batch.update(doc(db, 'depots', uid, 'cylinders', cyl.id), {
      fullCount: Math.max(0, cyl.fullCount - savedRecord.fullDelta),
      emptyCount: Math.max(0, cyl.emptyCount - savedRecord.emptyDelta),
      updatedAt: serverTimestamp(),
    });
  }
  await executeFirestoreWrite(
    batch.commit(),
    OperationType.DELETE,
    `depots/${uid}/stockMovements/${savedRecord.movementId}`
  );
}

export async function discardRecordsBatch(
  uid: string,
  salesToDelete: Sale[],
  movementsToDelete: StockMovement[],
  expensesToDelete: Expense[]
): Promise<void> {
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const s of salesToDelete) {
    ops.push((b) => b.delete(doc(db, 'depots', uid, 'sales', s.id)));
  }
  for (const m of movementsToDelete) {
    ops.push((b) => b.delete(doc(db, 'depots', uid, 'stockMovements', m.id)));
  }
  for (const e of expensesToDelete) {
    ops.push((b) => b.delete(doc(db, 'depots', uid, 'expenses', e.id)));
  }

  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK_SIZE)) {
      op(batch);
    }
    await executeFirestoreWrite(
      batch.commit(),
      OperationType.DELETE,
      `depots/${uid}/sales`
    );
  }
}

export async function applyHistoricalLedgerRebuild(input: {
  uid: string;
  existingCylinders: Cylinder[];
  salesToDelete: Sale[];
  movementsToDelete: StockMovement[];
  expensesToDelete?: Expense[];
  initialDateStr: string;
  initialStocks: HistoricalInitialStockInput[];
  events: HistoricalLedgerEventInput[];
}): Promise<{ finalStockByCode: Record<string, { full: number; empty: number }> }> {
  const {
    uid,
    existingCylinders,
    salesToDelete,
    movementsToDelete,
    expensesToDelete = [],
    initialDateStr,
    initialStocks,
    events,
  } = input;

  // 1. Ensure all referenced cylinder codes exist in Firestore BEFORE writing sales/movements
  const cylinderByCode = new Map<string, Cylinder>();
  for (const c of existingCylinders) {
    cylinderByCode.set(c.code.trim().toUpperCase(), c);
  }

  const allCodes = Array.from(
    new Set([
      ...initialStocks.map((s) => s.code.trim().toUpperCase()),
      ...events.map((e) => e.cylinderCode.trim().toUpperCase()),
    ])
  ).filter(Boolean);

  const missingCodes = allCodes.filter((code) => !cylinderByCode.has(code));
  if (missingCodes.length > 0) {
    const createBatch = writeBatch(db);
    for (const code of missingCodes) {
      const weightMatch = code.match(/(\d+)/);
      const weightKg = weightMatch ? Math.max(1, Number(weightMatch[1])) : 11;
      const slug = code.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const cylId = slug || `cyl_${Date.now()}`;
      const cylRef = doc(db, 'depots', uid, 'cylinders', cylId);
      const created: Cylinder = {
        id: cylId,
        ...buildAccessFields(uid),
        code: sanitizeText(code, FIELD_LIMITS.CYLINDER_CODE),
        name: sanitizeText(`Botijão ${code} (${weightKg} kg)`, FIELD_LIMITS.CYLINDER_NAME),
        weightKg,
        fullCount: 0,
        emptyCount: 0,
        salePrice: 1000,
        shellPrice: 2000,
        costPrice: 750,
        minStock: 3,
      };
      createBatch.set(cylRef, {
        ...buildAccessFields(uid),
        code: created.code,
        name: created.name,
        weightKg: created.weightKg,
        fullCount: 0,
        emptyCount: 0,
        salePrice: created.salePrice,
        shellPrice: created.shellPrice,
        costPrice: created.costPrice,
        minStock: created.minStock,
        updatedAt: serverTimestamp(),
      });
      cylinderByCode.set(code, created);
    }
    await executeFirestoreWrite(
      createBatch.commit(),
      OperationType.CREATE,
      `depots/${uid}/cylinders`
    );
  }

  // 2. Simulate running inventory balances
  const stockState: Record<string, { full: number; empty: number }> = {};
  for (const init of initialStocks) {
    const code = init.code.trim().toUpperCase();
    stockState[code] = {
      full: Math.max(0, Math.floor(init.fullCount)),
      empty: Math.max(0, Math.floor(init.emptyCount)),
    };
  }
  for (const code of allCodes) {
    if (!stockState[code]) {
      stockState[code] = { full: 0, empty: 0 };
    }
  }

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  // Delete discarded records first
  for (const s of salesToDelete) {
    ops.push((b) => b.delete(doc(db, 'depots', uid, 'sales', s.id)));
  }
  for (const m of movementsToDelete) {
    ops.push((b) => b.delete(doc(db, 'depots', uid, 'stockMovements', m.id)));
  }
  for (const e of expensesToDelete) {
    ops.push((b) => b.delete(doc(db, 'depots', uid, 'expenses', e.id)));
  }

  // Record initial stock adjustment movements on initialDateStr
  const initBaseDate = new Date(`${initialDateStr}T08:00:00`);
  for (const init of initialStocks) {
    const code = init.code.trim().toUpperCase();
    const cyl = cylinderByCode.get(code);
    if (!cyl) continue;
    const initTs = toSafeOccurredAtTimestamp(initBaseDate) ?? Timestamp.now();
    const movRef = doc(collection(db, 'depots', uid, 'stockMovements'));
    ops.push((b) =>
      b.set(movRef, {
        ...buildAccessFields(uid),
        cylinderId: cyl.id,
        cylinderCode: cyl.code,
        movementType: 'adjustment' as MovementType,
        fullDelta: Math.max(0, Math.floor(init.fullCount)),
        emptyDelta: Math.max(0, Math.floor(init.emptyCount)),
        note: sanitizeText(`Stock inicial (${initialDateStr})`, FIELD_LIMITS.MOVEMENT_NOTE),
        occurredAt: initTs,
        createdAt: serverTimestamp(),
      })
    );
  }

  // Group sequence within each day so timestamps maintain exact intra-day order
  const daySequenceCount: Record<string, number> = {};

  for (let idx = 0; idx < events.length; idx++) {
    const ev = events[idx];
    const code = ev.cylinderCode.trim().toUpperCase();
    const cyl = cylinderByCode.get(code);
    if (!cyl) continue;

    const seq = daySequenceCount[ev.dateStr] ?? 0;
    daySequenceCount[ev.dateStr] = seq + 1;
    const baseTime = new Date(`${ev.dateStr}T09:00:00`);
    const eventTime = new Date(baseTime.getTime() + seq * 15 * 60 * 1000);
    const occurredTs = toSafeOccurredAtTimestamp(eventTime) ?? Timestamp.now();
    const qty = Math.max(1, Math.floor(ev.quantity));

    const current = stockState[code];

    if (ev.kind === 'sale') {
      current.full = Math.max(0, current.full - qty);
      current.empty = current.empty + qty;

      const unitPrice = cyl.salePrice;
      const safeDiscount = clampNonNegative(ev.discount, unitPrice * qty);
      const totalAmount = clampNonNegative(unitPrice * qty - safeDiscount);
      const [, mm, dd] = ev.dateStr.split('-');
      const orderNumber = `HIST-${dd}${mm}-${String(idx + 1).padStart(2, '0')}`;

      const saleRef = doc(collection(db, 'depots', uid, 'sales'));
      ops.push((b) =>
        b.set(saleRef, {
          ...buildAccessFields(uid),
          orderNumber,
          customerId: '',
          customerName: 'Cliente Balcão',
          customerPhone: '',
          deliveryAddress: 'Retirada no Balcão',
          cylinderId: cyl.id,
          cylinderCode: cyl.code,
          saleMode: 'exchange' as SaleMode,
          quantity: qty,
          unitPrice,
          deliveryFee: 0,
          discount: safeDiscount,
          totalAmount,
          unitCost: cyl.costPrice,
          fulfillmentType: 'pickup' as FulfillmentType,
          driverName: '',
          paymentMethod: 'cash' as PaymentMethod,
          paymentStatus: 'paid',
          deliveryStatus: 'delivered',
          notes: sanitizeText(ev.note || 'Histórico reconstruído', FIELD_LIMITS.NOTES),
          occurredAt: occurredTs,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      const movRef = doc(collection(db, 'depots', uid, 'stockMovements'));
      ops.push((b) =>
        b.set(movRef, {
          ...buildAccessFields(uid),
          cylinderId: cyl.id,
          cylinderCode: cyl.code,
          movementType: 'sale' as MovementType,
          fullDelta: -qty,
          emptyDelta: qty,
          note: sanitizeText(`Pedido ${orderNumber} (Troca)`, FIELD_LIMITS.MOVEMENT_NOTE),
          occurredAt: occurredTs,
          createdAt: serverTimestamp(),
        })
      );
    } else if (ev.kind === 'restock') {
      const emptiesUsed = Math.min(current.empty, qty);
      current.full = current.full + qty;
      current.empty = current.empty - emptiesUsed;

      const movRef = doc(collection(db, 'depots', uid, 'stockMovements'));
      ops.push((b) =>
        b.set(movRef, {
          ...buildAccessFields(uid),
          cylinderId: cyl.id,
          cylinderCode: cyl.code,
          movementType: 'restock' as MovementType,
          fullDelta: qty,
          emptyDelta: -emptiesUsed,
          note: sanitizeText(ev.note || `Reposição ${cyl.code} (${qty} un)`, FIELD_LIMITS.MOVEMENT_NOTE),
          occurredAt: occurredTs,
          createdAt: serverTimestamp(),
        })
      );
    } else if (ev.kind === 'acquisition') {
      current.full = current.full + qty;

      const movRef = doc(collection(db, 'depots', uid, 'stockMovements'));
      ops.push((b) =>
        b.set(movRef, {
          ...buildAccessFields(uid),
          cylinderId: cyl.id,
          cylinderCode: cyl.code,
          movementType: 'restock' as MovementType,
          fullDelta: qty,
          emptyDelta: 0,
          note: sanitizeText(ev.note || `Aquisição de ${qty} ${cyl.code} completo`, FIELD_LIMITS.MOVEMENT_NOTE),
          occurredAt: occurredTs,
          createdAt: serverTimestamp(),
        })
      );
    }
  }

  // Update final cylinder fullCount & emptyCount
  for (const [code, finalCounts] of Object.entries(stockState)) {
    const cyl = cylinderByCode.get(code);
    if (!cyl) continue;
    const cylRef = doc(db, 'depots', uid, 'cylinders', cyl.id);
    ops.push((b) =>
      b.update(cylRef, {
        fullCount: finalCounts.full,
        emptyCount: finalCounts.empty,
        updatedAt: serverTimestamp(),
      })
    );
  }

  // Commit in chunks of 400 operations (Firestore batch limit is 500)
  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK_SIZE)) {
      op(batch);
    }
    await executeFirestoreWrite(
      batch.commit(),
      OperationType.WRITE,
      `depots/${uid}/cylinders`
    );
  }

  return { finalStockByCode: stockState };
}
