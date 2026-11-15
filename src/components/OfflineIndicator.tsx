import { RefreshCw, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineIndicatorProps {
  hasPendingWrites?: boolean;
}

export function OfflineIndicator({ hasPendingWrites = false }: OfflineIndicatorProps) {
  const isOnline = useOnlineStatus();

  if (isOnline && !hasPendingWrites) {
    return null;
  }

  if (!isOnline) {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-20 flex items-center gap-2.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg print:hidden"
      >
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span>
          Modo Offline — Dados salvos localmente{hasPendingWrites ? ' (aguardando sincronização)' : ''}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-20 flex items-center gap-2.5 rounded-lg bg-slate-900 dark:bg-slate-800 dark:border dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-white shadow-lg print:hidden"
    >
      <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
      <span>Sincronizando alterações salvas offline...</span>
    </div>
  );
}
