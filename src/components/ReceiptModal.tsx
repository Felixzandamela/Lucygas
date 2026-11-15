import { Printer, X } from 'lucide-react';
import { formatCurrency, formatDateTime } from '../lib/formatters';
import { type CurrencyCode, PAYMENT_METHOD_LABELS, type Sale } from '../types/gas';

interface ReceiptModalProps {
  sale: Sale;
  depotName: string;
  currency: CurrencyCode;
  onClose: () => void;
}

export function ReceiptModal({ sale, depotName, currency, onClose }: ReceiptModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Recibo do pedido ${sale.orderNumber}`}
      className="fixed inset-0 z-50 bg-slate-950/50 dark:bg-slate-950/75 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 print:hidden">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Visualização de Impressão
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
            aria-label="Fechar visualização"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          <div id="printable-receipt" className="p-6 space-y-5 text-slate-900 bg-white">
            <div className="text-center border-b border-dashed border-slate-300 pb-4">
              <p className="font-display text-lg font-bold tracking-tight">{depotName}</p>
              <p className="text-xs text-slate-500 mt-0.5">Comprovante de Venda de GLP</p>
              <p className="font-mono text-xs font-semibold text-slate-800 mt-2">
                {sale.orderNumber} · {formatDateTime(sale.createdAt)}
              </p>
            </div>

            <div className="space-y-1.5 text-xs border-b border-dashed border-slate-300 pb-4">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Cliente:</span>
                <span className="font-medium text-right">{sale.customerName}</span>
              </div>
              {sale.customerPhone && (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Telefone:</span>
                  <span className="font-mono text-right">{sale.customerPhone}</span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 shrink-0">Atendimento:</span>
                <span className="text-right">
                  {sale.fulfillmentType === 'pickup'
                    ? 'Retirada no Balcão'
                    : sale.deliveryAddress || 'Entrega'}
                </span>
              </div>
              {sale.fulfillmentType === 'delivery' && sale.driverName && (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Entregador:</span>
                  <span className="text-right">{sale.driverName}</span>
                </div>
              )}
            </div>

            <div className="space-y-2 border-b border-dashed border-slate-300 pb-4">
              <div className="flex justify-between text-xs font-medium text-slate-500">
                <span>Descrição do Item</span>
                <span>Subtotal</span>
              </div>
              <div className="flex justify-between items-start gap-4 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {sale.quantity}x Botijão {sale.cylinderCode}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sale.saleMode === 'exchange'
                      ? 'Recarga (Troca de casco)'
                      : 'Botijão completo (Com casco)'}{' '}
                    · {formatCurrency(sale.unitPrice, currency)} un
                  </p>
                </div>
                <span className="font-mono tabular-nums font-medium shrink-0">
                  {formatCurrency(sale.unitPrice * sale.quantity, currency)}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 text-sm">
              {sale.deliveryFee > 0 && (
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Taxa de entrega</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(sale.deliveryFee, currency)}
                  </span>
                </div>
              )}
              {sale.discount > 0 && (
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Desconto</span>
                  <span className="font-mono tabular-nums">
                    - {formatCurrency(sale.discount, currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-2 border-t border-slate-200">
                <span className="font-display font-bold text-base">Valor Total</span>
                <span className="font-mono tabular-nums text-xl font-bold">
                  {formatCurrency(sale.totalAmount, currency)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-600 pt-1">
                <span>Pagamento: {PAYMENT_METHOD_LABELS[sale.paymentMethod]}</span>
                <span className="font-medium">
                  {sale.paymentStatus === 'paid' ? 'Pago' : 'Em Aberto'}
                </span>
              </div>
            </div>

            {sale.notes && (
              <div className="text-xs text-slate-600 border-t border-dashed border-slate-300 pt-3">
                <span className="font-medium">Obs.:</span> {sale.notes}
              </div>
            )}

            <p className="text-center text-[11px] text-slate-400 pt-2 border-t border-dashed border-slate-300">
              Obrigado pela preferência!
            </p>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5 shrink-0 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>
    </div>
  );
}
