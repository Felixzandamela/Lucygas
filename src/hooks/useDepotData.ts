import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getRecordMillis } from '../lib/formatters';
import {
  activateSelfMemberRecord,
  normalizeEmail,
  setDepotMemberEmailsContext,
} from '../services/depotService';
import {
  type Customer,
  type Cylinder,
  type Depot,
  type DepotMember,
  type Expense,
  type MemberPermissions,
  resolveEffectivePermissions,
  type Sale,
  type StockMovement,
} from '../types/gas';

export interface DepotDataState {
  depot: Depot | null;
  cylinders: Cylinder[];
  customers: Customer[];
  sales: Sale[];
  movements: StockMovement[];
  expenses: Expense[];
  members: DepotMember[];
  permissions: MemberPermissions;
  loading: boolean;
  hasPendingWrites: boolean;
  error: string | null;
}

const INITIAL_FLAGS = {
  depot: false,
  cylinders: false,
  customers: false,
  sales: false,
  movements: false,
  expenses: false,
  members: false,
};

export function useDepotData(): DepotDataState {
  const { user, authReady, depotReady, activeDepotId } = useAuth();
  const [depot, setDepot] = useState<Depot | null>(null);
  const [cylinders, setCylinders] = useState<Cylinder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<DepotMember[]>([]);
  const [loadedFlags, setLoadedFlags] = useState(INITIAL_FLAGS);
  const [pendingFlags, setPendingFlags] = useState(INITIAL_FLAGS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authReady || !depotReady || !user || !activeDepotId) {
      return;
    }

    const depotId = activeDepotId;
    const userEmail = normalizeEmail(user.email);
    const accessFilter = userEmail
      ? where('memberEmails', 'array-contains', userEmail)
      : where('ownerId', '==', user.uid);

    setError(null);
    setLoadedFlags(INITIAL_FLAGS);
    setPendingFlags(INITIAL_FLAGS);

    const markLoaded = (key: keyof typeof loadedFlags, pending: boolean) => {
      setLoadedFlags((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
      setPendingFlags((prev) => (prev[key] === pending ? prev : { ...prev, [key]: pending }));
    };

    const unsubDepot = onSnapshot(
      doc(db, 'depots', depotId),
      (snap) => {
        if (snap.exists()) {
          const data = {
            id: snap.id,
            ...(snap.data({ serverTimestamps: 'estimate' }) as Omit<Depot, 'id'>),
          };
          setDepotMemberEmailsContext(depotId, data.memberEmails);
          setDepot(data);
        }
        markLoaded('depot', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.GET, `depots/${depotId}`);
      }
    );

    const unsubCylinders = onSnapshot(
      query(collection(db, 'depots', depotId, 'cylinders'), accessFilter),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Cylinder, 'id'>),
          }))
          .sort((a, b) => a.weightKg - b.weightKg);
        setCylinders(items);
        markLoaded('cylinders', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${depotId}/cylinders`);
      }
    );

    const unsubCustomers = onSnapshot(
      query(collection(db, 'depots', depotId, 'customers'), accessFilter),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Customer, 'id'>),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        setCustomers(items);
        markLoaded('customers', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${depotId}/customers`);
      }
    );

    const unsubSales = onSnapshot(
      query(collection(db, 'depots', depotId, 'sales'), accessFilter),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Sale, 'id'>),
          }))
          .sort((a, b) => getRecordMillis(b) - getRecordMillis(a));
        setSales(items);
        markLoaded('sales', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${depotId}/sales`);
      }
    );

    const unsubMovements = onSnapshot(
      query(collection(db, 'depots', depotId, 'stockMovements'), accessFilter),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<StockMovement, 'id'>),
          }))
          .sort((a, b) => getRecordMillis(b) - getRecordMillis(a));
        setMovements(items);
        markLoaded('movements', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${depotId}/stockMovements`);
      }
    );

    const unsubExpenses = onSnapshot(
      query(collection(db, 'depots', depotId, 'expenses'), accessFilter),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Expense, 'id'>),
          }))
          .sort((a, b) => getRecordMillis(b) - getRecordMillis(a));
        setExpenses(items);
        markLoaded('expenses', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${depotId}/expenses`);
      }
    );

    const unsubMembers = onSnapshot(
      query(collection(db, 'depots', depotId, 'members'), accessFilter),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<DepotMember, 'id'>),
          }))
          .sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'));
        setMembers(items);
        markLoaded('members', snap.metadata.hasPendingWrites);
        if (userEmail) {
          void activateSelfMemberRecord(
            depotId,
            user.uid,
            userEmail,
            user.displayName || '',
            items
          );
        }
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${depotId}/members`);
      }
    );

    return () => {
      unsubDepot();
      unsubCylinders();
      unsubCustomers();
      unsubSales();
      unsubMovements();
      unsubExpenses();
      unsubMembers();
    };
  }, [user, authReady, depotReady, activeDepotId]);

  const permissions = useMemo(
    () => resolveEffectivePermissions(depot, user?.uid ?? '', user?.email ?? ''),
    [depot, user?.uid, user?.email]
  );

  const loading =
    !authReady ||
    !depotReady ||
    !activeDepotId ||
    !loadedFlags.depot ||
    !loadedFlags.cylinders ||
    !loadedFlags.customers ||
    !loadedFlags.sales;

  const hasPendingWrites = Object.values(pendingFlags).some(Boolean);

  return {
    depot,
    cylinders,
    customers,
    sales,
    movements,
    expenses,
    members,
    permissions,
    loading,
    hasPendingWrites,
    error,
  };
}
