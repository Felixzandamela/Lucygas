import { AlertTriangle, Bell, BellOff, BellRing, Check, Send, Truck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AppAlertItem, PushNotificationPrefs, PushPermissionState } from '../hooks/usePushNotifications';
import type { AppSection } from '../types/gas';

interface NotificationCenterProps {
  permission: PushPermissionState;
  prefs: PushNotificationPrefs;
  alerts: AppAlertItem[];
  unreadCount: number;
  feedbackMsg: string | null;
  isPushActive: boolean;
  onEnablePush: () => Promise<boolean>;
  onDisablePush: () => void;
  onUpdatePrefs: (partial: Partial<PushNotificationPrefs>) => void;
  onSendTest: () => Promise<void>;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNavigate: (section: AppSection) => void;
}

function formatAlertTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationCenter({
  permission,
  prefs,
  alerts,
  unreadCount,
  feedbackMsg,
  isPushActive,
  onEnablePush,
  onDisablePush,
  onUpdatePrefs,
  onSendTest,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigate,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notificações e alertas"
        aria-expanded={open}
        className="relative z-50 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
      >
        {isPushActive ? (
          <BellRing className="w-4 h-4 text-orange-600 dark:text-orange-400" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-600 text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-label="Central de Alertas"
            className="fixed inset-x-3 top-[4.5rem] max-h-[calc(100dvh-5.25rem)] sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100dvh-5.5rem)] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  Central de Alertas
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Estoque mínimo e entregas pendentes
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="px-2 py-1.5 rounded text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Check className="w-3 h-3" />
                    <span>Lidas</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Fechar alertas"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Push Controls Bar */}
            <div className="px-4 py-2.5 sm:py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 space-y-2 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 min-w-0">
                  {isPushActive ? (
                    <BellRing className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <BellOff className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                  )}
                  <span className="truncate">
                    {isPushActive
                      ? 'Push PWA ativado'
                      : permission === 'denied'
                        ? 'Push bloqueado no navegador'
                        : 'Push PWA desativado'}
                  </span>
                </div>

                {isPushActive ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onSendTest()}
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Send className="w-3 h-3" />
                      <span>Testar</span>
                    </button>
                    <button
                      type="button"
                      onClick={onDisablePush}
                      className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer whitespace-nowrap"
                    >
                      Pausar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onEnablePush()}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-[11px] font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Ativar Push
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.lowStockAlerts}
                    onChange={(e) => onUpdatePrefs({ lowStockAlerts: e.target.checked })}
                    className="rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600"
                  />
                  <span>Estoque mínimo</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.pendingDeliveryAlerts}
                    onChange={(e) => onUpdatePrefs({ pendingDeliveryAlerts: e.target.checked })}
                    className="rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600"
                  />
                  <span>Novas entregas</span>
                </label>
              </div>

              {feedbackMsg && (
                <p className="text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5">
                  {feedbackMsg}
                </p>
              )}
            </div>

            {/* Alerts Feed */}
            <div className="flex-1 min-h-0 sm:max-h-80 overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-slate-800">
              {alerts.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  Nenhum alerta ativo no momento. Estoque e entregas em dia.
                </div>
              ) : (
                alerts.map((alert) => {
                  const isStock = alert.type === 'low_stock' || alert.type === 'out_of_stock';
                  const isOut = alert.type === 'out_of_stock';
                  return (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => {
                        onMarkAsRead(alert.id);
                        onNavigate(alert.targetSection);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer ${
                        !alert.read
                          ? 'bg-orange-50/40 dark:bg-orange-950/25'
                          : 'bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          isOut
                            ? 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-400'
                            : isStock
                              ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-400'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {isStock ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : (
                          <Truck className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {alert.title}
                          </p>
                          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                            {formatAlertTime(alert.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                          {alert.body}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
