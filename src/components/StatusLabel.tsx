import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  Banknote,
} from 'lucide-react';
import {
  DELIVERY_STATUS_LABELS,
  type DeliveryStatus,
  type PaymentStatus,
} from '../types/gas';

export function DeliveryStatusLabel({ status }: { status: DeliveryStatus }) {
  if (status === 'delivered') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{DELIVERY_STATUS_LABELS[status]}</span>
      </span>
    );
  }
  if (status === 'in_route') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Truck className="w-3.5 h-3.5 shrink-0" />
        <span>{DELIVERY_STATUS_LABELS[status]}</span>
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{DELIVERY_STATUS_LABELS[status]}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      <span>{DELIVERY_STATUS_LABELS[status]}</span>
    </span>
  );
}

export function PaymentStatusLabel({ status }: { status: PaymentStatus }) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Pago</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
      <Banknote className="w-3.5 h-3.5 shrink-0" />
      <span>Em Aberto</span>
    </span>
  );
}

export function StockHealthLabel({ fullCount, minStock }: { fullCount: number; minStock: number }) {
  if (fullCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Esgotado</span>
      </span>
    );
  }
  if (fullCount < minStock) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Abaixo do Mínimo</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      <span>Normal</span>
    </span>
  );
}
