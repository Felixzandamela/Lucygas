import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { Customer, Cylinder, Depot, Expense, Sale, StockMovement } from '../types/gas';

export interface DepotDataState {
  depot: Depot | null;
  cylinders: Cylinder[];
  customers: Customer[];
  sales: Sale[];
  movements: StockMovement[];
  expenses: Expense[];
  loading: boolean;
  hasPendingWrites: boolean;
  error: string | null;
}

export function useDepotData(): DepotDataState {
  const { user, authReady, depotReady } = useAuth();
  const [depot, setDepot] = useState<Depot | null>(null);
  const [cylinders, setCylinders] = useState<Cylinder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadedFlags, setLoadedFlags] = useState({
    depot: false,
    cylinders: false,
    customers: false,
    sales: false,
    movements: false,
    expenses: false,
  });
  const [pendingFlags, setPendingFlags] = useState({
    depot: false,
    cylinders: false,
    customers: false,
    sales: false,
    movements: false,
    expenses: false,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authReady || !depotReady || !user) {
      return;
    }

    const uid = user.uid;
    setError(null);

    const markLoaded = (key: keyof typeof loadedFlags, pending: boolean) => {
      setLoadedFlags((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
      setPendingFlags((prev) => (prev[key] === pending ? prev : { ...prev, [key]: pending }));
    };

    const unsubDepot = onSnapshot(
      doc(db, 'depots', uid),
      (snap) => {
        if (snap.exists()) {
          setDepot({
            id: snap.id,
            ...(snap.data({ serverTimestamps: 'estimate' }) as Omit<Depot, 'id'>),
          });
        }
        markLoaded('depot', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.GET, `depots/${uid}`);
      }
    );

    const unsubCylinders = onSnapshot(
      query(collection(db, 'depots', uid, 'cylinders'), where('ownerId', '==', uid)),
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
        handleFirestoreError(err, OperationType.LIST, `depots/${uid}/cylinders`);
      }
    );

    const unsubCustomers = onSnapshot(
      query(collection(db, 'depots', uid, 'customers'), where('ownerId', '==', uid)),
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
        handleFirestoreError(err, OperationType.LIST, `depots/${uid}/customers`);
      }
    );

    const unsubSales = onSnapshot(
      query(collection(db, 'depots', uid, 'sales'), where('ownerId', '==', uid)),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Sale, 'id'>),
          }))
          .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now()));
        setSales(items);
        markLoaded('sales', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${uid}/sales`);
      }
    );

    const unsubMovements = onSnapshot(
      query(collection(db, 'depots', uid, 'stockMovements'), where('ownerId', '==', uid)),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<StockMovement, 'id'>),
          }))
          .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now()));
        setMovements(items);
        markLoaded('movements', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${uid}/stockMovements`);
      }
    );

    const unsubExpenses = onSnapshot(
      query(collection(db, 'depots', uid, 'expenses'), where('ownerId', '==', uid)),
      (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Expense, 'id'>),
          }))
          .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now()));
        setExpenses(items);
        markLoaded('expenses', snap.metadata.hasPendingWrites);
      },
      (err) => {
        setError(err.message);
        handleFirestoreError(err, OperationType.LIST, `depots/${uid}/expenses`);
      }
    );

    return () => {
      unsubDepot();
      unsubCylinders();
      unsubCustomers();
      unsubSales();
      unsubMovements();
      unsubExpenses();
    };
  }, [user, authReady, depotReady]);

  const loading =
    !authReady ||
    !depotReady ||
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
    loading,
    hasPendingWrites,
    error,
  };
}
