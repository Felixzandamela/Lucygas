import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cylinder, Sale } from '../types/gas';

export type PushPermissionState = NotificationPermission | 'unsupported';

export interface PushNotificationPrefs {
  enabled: boolean;
  lowStockAlerts: boolean;
  pendingDeliveryAlerts: boolean;
}

export interface AppAlertItem {
  id: string;
  type: 'out_of_stock' | 'low_stock' | 'pending_delivery';
  title: string;
  body: string;
  targetSection: 'inventory' | 'sales';
  createdAt: number;
  read: boolean;
}

const DEFAULT_PREFS: PushNotificationPrefs = {
  enabled: false,
  lowStockAlerts: true,
  pendingDeliveryAlerts: true,
};

function getStorageKey(uid: string): string {
  return `chamagest_push_prefs_${uid}`;
}

function getPermissionState(): PushPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

async function dispatchSystemNotification(
  title: string,
  body: string,
  tag: string
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch {
    try {
      new Notification(title, options);
      return true;
    } catch {
      return false;
    }
  }
}

export function usePushNotifications({
  uid,
  loading,
  cylinders,
  sales,
}: {
  uid: string | undefined;
  loading: boolean;
  cylinders: Cylinder[];
  sales: Sale[];
}) {
  const [permission, setPermission] = useState<PushPermissionState>(getPermissionState);
  const [prefs, setPrefs] = useState<PushNotificationPrefs>(DEFAULT_PREFS);
  const [alerts, setAlerts] = useState<AppAlertItem[]>([]);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const hydratedRef = useRef(false);
  const knownLowStockLevelsRef = useRef<Map<string, number>>(new Map());
  const knownPendingDeliveryIdsRef = useRef<Set<string>>(new Set());

  // Load saved preferences per depot user
  useEffect(() => {
    if (!uid || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(getStorageKey(uid));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PushNotificationPrefs>;
        setPrefs({
          enabled: Boolean(parsed.enabled),
          lowStockAlerts: parsed.lowStockAlerts ?? true,
          pendingDeliveryAlerts: parsed.pendingDeliveryAlerts ?? true,
        });
      } else {
        setPrefs(DEFAULT_PREFS);
      }
    } catch {
      setPrefs(DEFAULT_PREFS);
    }
    setPermission(getPermissionState());
  }, [uid]);

  // Reset tracking when user changes
  useEffect(() => {
    hydratedRef.current = false;
    knownLowStockLevelsRef.current = new Map();
    knownPendingDeliveryIdsRef.current = new Set();
    setAlerts([]);
  }, [uid]);

  const persistPrefs = useCallback(
    (next: PushNotificationPrefs) => {
      setPrefs(next);
      if (!uid || typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(getStorageKey(uid), JSON.stringify(next));
      } catch {
        // Ignore storage quota issues
      }
    },
    [uid]
  );

  const updatePrefs = useCallback(
    (partial: Partial<PushNotificationPrefs>) => {
      persistPrefs({ ...prefs, ...partial });
    },
    [prefs, persistPrefs]
  );

  // Monitor cylinders & sales in real time
  useEffect(() => {
    if (!uid || loading) return;

    const now = Date.now();
    const lowStockCylinders = cylinders.filter(
      (c) => c.fullCount === 0 || c.fullCount < c.minStock
    );
    const pendingDeliveries = sales.filter(
      (s) => s.deliveryStatus === 'pending' && s.fulfillmentType === 'delivery'
    );

    if (!hydratedRef.current) {
      hydratedRef.current = true;

      const initialAlerts: AppAlertItem[] = [];

      for (const cyl of lowStockCylinders) {
        knownLowStockLevelsRef.current.set(cyl.id, cyl.fullCount);
        const isOut = cyl.fullCount === 0;
        initialAlerts.push({
          id: `stock-${cyl.id}-${cyl.fullCount}`,
          type: isOut ? 'out_of_stock' : 'low_stock',
          title: isOut
            ? `Estoque esgotado: ${cyl.code}`
            : `Estoque mínimo atingido: ${cyl.code}`,
          body: isOut
            ? `${cyl.name} está zerado (mínimo: ${cyl.minStock} un).`
            : `${cyl.name} com ${cyl.fullCount} cheios (mínimo configurado: ${cyl.minStock} un).`,
          targetSection: 'inventory',
          createdAt: now,
          read: false,
        });
      }

      for (const sale of pendingDeliveries) {
        knownPendingDeliveryIdsRef.current.add(sale.id);
        initialAlerts.push({
          id: `delivery-${sale.id}`,
          type: 'pending_delivery',
          title: `Entrega pendente: ${sale.orderNumber}`,
          body: `${sale.quantity}x ${sale.cylinderCode} para ${sale.customerName} — ${
            sale.deliveryAddress || 'Endereço não informado'
          }`,
          targetSection: 'sales',
          createdAt: sale.createdAt?.toMillis() ?? now,
          read: false,
        });
      }

      setAlerts(initialAlerts.slice(0, 30));

      // Optionally notify on boot if permission already granted and enabled
      if (prefs.enabled && permission === 'granted') {
        if (prefs.lowStockAlerts && lowStockCylinders.length > 0) {
          const codes = lowStockCylinders.map((c) => c.code).join(', ');
          void dispatchSystemNotification(
            'Alerta de Estoque Mínimo — Lucygas',
            `${lowStockCylinders.length} tipo(s) abaixo do mínimo: ${codes}.`,
            `boot-low-stock-${lowStockCylinders.length}`
          );
        }
        if (prefs.pendingDeliveryAlerts && pendingDeliveries.length > 0) {
          void dispatchSystemNotification(
            'Entregas Pendentes — Lucygas',
            `Há ${pendingDeliveries.length} entrega(s) aguardando despacho.`,
            `boot-pending-deliveries-${pendingDeliveries.length}`
          );
        }
      }
      return;
    }

    const newAlerts: AppAlertItem[] = [];

    // Check cylinder stock transitions
    for (const cyl of cylinders) {
      const isLow = cyl.fullCount === 0 || cyl.fullCount < cyl.minStock;
      const prevLevel = knownLowStockLevelsRef.current.get(cyl.id);

      if (!isLow) {
        knownLowStockLevelsRef.current.delete(cyl.id);
        continue;
      }

      if (prevLevel === undefined || cyl.fullCount < prevLevel) {
        knownLowStockLevelsRef.current.set(cyl.id, cyl.fullCount);
        const isOut = cyl.fullCount === 0;
        const title = isOut
          ? `Estoque esgotado: ${cyl.code}`
          : `Estoque abaixo do mínimo: ${cyl.code}`;
        const body = isOut
          ? `${cyl.name} acabou no pátio (mínimo: ${cyl.minStock} un).`
          : `Restam apenas ${cyl.fullCount} un de ${cyl.code} (mínimo: ${cyl.minStock} un).`;

        newAlerts.push({
          id: `stock-${cyl.id}-${cyl.fullCount}-${now}`,
          type: isOut ? 'out_of_stock' : 'low_stock',
          title,
          body,
          targetSection: 'inventory',
          createdAt: now,
          read: false,
        });

        if (prefs.enabled && prefs.lowStockAlerts && permission === 'granted') {
          void dispatchSystemNotification(title, body, `low-stock-${cyl.id}`);
        }
      }
    }

    // Check newly arriving pending deliveries
    const currentPendingSet = new Set<string>();
    for (const sale of pendingDeliveries) {
      currentPendingSet.add(sale.id);
      if (!knownPendingDeliveryIdsRef.current.has(sale.id)) {
        const title = `Nova entrega pendente: ${sale.orderNumber}`;
        const body = `${sale.quantity}x ${sale.cylinderCode} para ${sale.customerName}${
          sale.deliveryAddress ? ` · ${sale.deliveryAddress}` : ''
        }`;

        newAlerts.push({
          id: `delivery-${sale.id}`,
          type: 'pending_delivery',
          title,
          body,
          targetSection: 'sales',
          createdAt: now,
          read: false,
        });

        if (prefs.enabled && prefs.pendingDeliveryAlerts && permission === 'granted') {
          void dispatchSystemNotification(title, body, `delivery-${sale.id}`);
        }
      }
    }
    knownPendingDeliveryIdsRef.current = currentPendingSet;

    if (newAlerts.length > 0) {
      setAlerts((prev) => [...newAlerts, ...prev].slice(0, 30));
    }
  }, [uid, loading, cylinders, sales, prefs.enabled, prefs.lowStockAlerts, prefs.pendingDeliveryAlerts, permission]);

  const requestAndEnable = useCallback(async (): Promise<boolean> => {
    setFeedbackMsg(null);
    const current = getPermissionState();
    if (current === 'unsupported') {
      setPermission('unsupported');
      setFeedbackMsg(
        'Este navegador não suporta notificações push nativas. A central de alertas do app continua ativa.'
      );
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        persistPrefs({ ...prefs, enabled: true });
        await dispatchSystemNotification(
          'Notificações Push Ativadas — Lucygas',
          'Você receberá alertas de estoque mínimo e novas entregas pendentes.',
          'lucygas-push-enabled'
        );
        setFeedbackMsg('Notificações push ativadas neste dispositivo.');
        return true;
      }
      persistPrefs({ ...prefs, enabled: false });
      setFeedbackMsg(
        'Permissão bloqueada pelo navegador. Libere as notificações nas configurações do site ou abra o app instalado fora do painel.'
      );
      return false;
    } catch {
      setFeedbackMsg(
        'Não foi possível solicitar permissão de notificação neste ambiente. Use o aplicativo instalado (PWA) para alertas do sistema.'
      );
      return false;
    }
  }, [prefs, persistPrefs]);

  const disablePush = useCallback(() => {
    persistPrefs({ ...prefs, enabled: false });
    setFeedbackMsg('Notificações push pausadas neste dispositivo.');
  }, [prefs, persistPrefs]);

  const sendTestNotification = useCallback(async () => {
    setFeedbackMsg(null);
    if (getPermissionState() !== 'granted') {
      const ok = await requestAndEnable();
      if (!ok) return;
    }
    const lowCount = cylinders.filter((c) => c.fullCount === 0 || c.fullCount < c.minStock).length;
    const pendingCount = sales.filter(
      (s) => s.deliveryStatus === 'pending' && s.fulfillmentType === 'delivery'
    ).length;

    const sent = await dispatchSystemNotification(
      'Teste de Alerta — Lucygas',
      `Status atual: ${lowCount} botijão(ões) abaixo do mínimo e ${pendingCount} entrega(s) pendente(s).`,
      `lucygas-test-${Date.now()}`
    );
    setFeedbackMsg(
      sent
        ? 'Notificação de teste enviada via Service Worker PWA.'
        : 'Não foi possível exibir a notificação de teste no navegador.'
    );
  }, [cylinders, sales, requestAndEnable]);

  const markAsRead = useCallback((id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  }, []);

  const markAllAsRead = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);

  return {
    permission,
    prefs,
    alerts,
    unreadCount,
    feedbackMsg,
    isPushActive: permission === 'granted' && prefs.enabled,
    requestAndEnable,
    disablePush,
    updatePrefs,
    sendTestNotification,
    markAsRead,
    markAllAsRead,
    clearAlerts,
  };
}
