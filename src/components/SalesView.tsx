import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Check, Eye, FileText, List, Map as MapIcon, Printer, Search, Trash2, TrendingUp, Truck, X, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatCurrency, formatDateTime, getRecordDate, getRecordMillis, getRecordTimestamp } from '../lib/formatters';
import { deleteSaleRecord, markSalePaid, updateSaleDelivery } from '../services/depotService';
import {
  type CurrencyCode,
  type Customer,
  type Cylinder,
  DELIVERY_STATUS_LABELS,
  type DeliveryStatus,
  type Expense,
  type MemberPermissions,
  PAYMENT_METHOD_LABELS,
  type Sale,
} from '../types/gas';
import { DeliveryRouteMap } from './DeliveryRouteMap';
import { ReceiptModal } from './ReceiptModal';
import { DeliveryStatusLabel, PaymentStatusLabel } from './StatusLabel';

type SalesPeriod = 'all' | 'today' | '7d' | 'this_month' | 'last_month' | 'custom';

interface SalesViewProps {
  uid: string;
  depotName?: string;
  currency: CurrencyCode;
  sales: Sale[];
  cylinders: Cylinder[];
  customers: Customer[];
  expenses?: Expense[];
  drivers: string[];
  permissions: MemberPermissions;
}

function toInputDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function SalesView({
  uid,
  depotName = 'Lucygas Distribuidora',
  currency,
  sales,
  cylinders,
  customers,
  expenses = [],
  drivers,
  permissions,
}: SalesViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeliveryStatus>('all');
  const [period, setPeriod] = useState<SalesPeriod>('this_month');
  const [customStart, setCustomStart] = useState<string>(() => {
    const now = new Date();
    return toInputDate(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [customEnd, setCustomEnd] = useState<string>(() => toInputDate(new Date()));
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const dateBounds = useMemo(() => {
    const now = new Date();
    if (period === 'all') return { start: 0, end: Infinity };
    if (period === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return { start, end: Infinity };
    }
    if (period === '7d') {
      return { start: Date.now() - 7 * 86400000, end: Infinity };
    }
    if (period === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { start, end: Infinity };
    }
    if (period === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime();
      return { start, end };
    }
    const start = customStart ? new Date(`${customStart}T00:00:00`).getTime() : 0;
    const end = customEnd ? new Date(`${customEnd}T23:59:59.999`).getTime() : Infinity;
    return { start, end };
  }, [period, customStart, customEnd]);

  const periodAndSearchSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      const ms = getRecordMillis(s);
      if (ms < dateBounds.start || ms > dateBounds.end) return false;
      if (!q) return true;
      return (
        s.orderNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q) ||
        s.deliveryAddress.toLowerCase().includes(q) ||
        s.driverName.toLowerCase().includes(q) ||
        s.cylinderCode.toLowerCase().includes(q)
      );
    });
  }, [sales, search, dateBounds]);

  const filteredSales = useMemo(() => {
    if (statusFilter === 'all') return periodAndSearchSales;
    return periodAndSearchSales.filter((s) => s.deliveryStatus === statusFilter);
  }, [periodAndSearchSales, statusFilter]);

  const cylinderCostMap = useMemo(
    () => new Map(cylinders.map((c) => [c.id, c.costPrice])),
    [cylinders]
  );

  const getSaleCost = (s: Sale) => {
    if (s.deliveryStatus === 'cancelled') return 0;
    const unitCost = s.unitCost > 0 ? s.unitCost : (cylinderCostMap.get(s.cylinderId) ?? 0);
    return unitCost * s.quantity;
  };

  const getSaleProfit = (s: Sale) => {
    if (s.deliveryStatus === 'cancelled') return 0;
    return s.totalAmount - getSaleCost(s);
  };

  const periodExpenses = useMemo(() => {
    return expenses.reduce((acc, exp) => {
      const ms = getRecordMillis(exp);
      if (ms < dateBounds.start || ms > dateBounds.end) return acc;
      return acc + exp.amount;
    }, 0);
  }, [expenses, dateBounds]);

  const hasNarrowFilter = Boolean(search.trim()) || statusFilter !== 'all';

  const filteredSummary = useMemo(() => {
    const active = filteredSales.filter((s) => s.deliveryStatus !== 'cancelled');
    const cancelledCount = filteredSales.length - active.length;
    const totalValue = active.reduce((acc, s) => acc + s.totalAmount, 0);
    const totalUnits = active.reduce((acc, s) => acc + s.quantity, 0);
    const totalCost = active.reduce((acc, s) => {
      const unitCost = s.unitCost > 0 ? s.unitCost : (cylinderCostMap.get(s.cylinderId) ?? 0);
      return acc + unitCost * s.quantity;
    }, 0);
    const cylindersProfit = totalValue - totalCost;
    const estimatedNetResult = hasNarrowFilter ? cylindersProfit : cylindersProfit - periodExpenses;
    const paidTotal = active
      .filter((s) => s.paymentStatus === 'paid')
      .reduce((acc, s) => acc + s.totalAmount, 0);
    const pendingTotal = active
      .filter((s) => s.paymentStatus === 'pending')
      .reduce((acc, s) => acc + s.totalAmount, 0);
    return {
      count: filteredSales.length,
      activeCount: active.length,
      cancelledCount,
      totalValue,
      totalUnits,
      totalCost,
      cylindersProfit,
      estimatedNetResult,
      paidTotal,
      pendingTotal,
    };
  }, [filteredSales, cylinderCostMap, hasNarrowFilter, periodExpenses]);

  const formatBrDate = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
  };

  const getPeriodLabel = () => {
    switch (period) {
      case 'this_month':
        return 'Este Mês';
      case 'last_month':
        return 'Mês Anterior';
      case 'today':
        return 'Hoje';
      case '7d':
        return 'Últimos 7 Dias';
      case 'all':
        return 'Todos os Períodos';
      case 'custom':
        return `${formatBrDate(customStart)} a ${formatBrDate(customEnd)}`;
    }
  };

  const getPeriodSuffix = () =>
    period === 'custom' ? `${customStart}-a-${customEnd}` : period.replace('_', '-');

  const handleExportPdf = () => {
    if (filteredSales.length === 0) return;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    const statusLabel =
      statusFilter === 'all' ? 'Todos' : DELIVERY_STATUS_LABELS[statusFilter];
    const generatedAt = new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(depotName, margin, 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(71, 85, 105);
    doc.text('Relatório de Vendas e Entregas', margin, 22);

    doc.setFontSize(9);
    doc.text(`Período: ${getPeriodLabel()}  |  Status: ${statusLabel}`, pageWidth - margin, 16, {
      align: 'right',
    });
    doc.text(`Emitido em: ${generatedAt}`, pageWidth - margin, 22, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, 26, pageWidth - margin, 26);

    // Summary rows (line 1: volume & receivables; line 2: cost & profit)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    const volumeParts = [
      `Pedidos: ${filteredSummary.count}${filteredSummary.cancelledCount > 0 ? ` (${filteredSummary.cancelledCount} cancel.)` : ''}`,
      `Botijões: ${filteredSummary.totalUnits}`,
      `Valor Bruto: ${formatCurrency(filteredSummary.totalValue, currency)}`,
      `Pago: ${formatCurrency(filteredSummary.paidTotal, currency)}`,
      `Em Aberto: ${formatCurrency(filteredSummary.pendingTotal, currency)}`,
    ];
    doc.text(volumeParts.join('   •   '), margin, 32);

    const profitParts = [
      `Custo das Botijas (CMV): ${formatCurrency(filteredSummary.totalCost, currency)}`,
      `Lucro das Botijas: ${formatCurrency(filteredSummary.cylindersProfit, currency)}`,
      ...(!hasNarrowFilter && periodExpenses > 0
        ? [`Despesas Operacionais: ${formatCurrency(periodExpenses, currency)}`]
        : []),
      `Resultado Líquido Estimado: ${formatCurrency(filteredSummary.estimatedNetResult, currency)}`,
    ];
    if (filteredSummary.estimatedNetResult >= 0) {
      doc.setTextColor(4, 120, 87);
    } else {
      doc.setTextColor(185, 28, 28);
    }
    doc.text(profitParts.join('   •   '), margin, 37.5);
    doc.setTextColor(15, 23, 42);

    const tableRows = filteredSales.map((s) => [
      s.orderNumber,
      formatDateTime(getRecordTimestamp(s)),
      s.customerName,
      `${s.quantity}x ${s.cylinderCode} (${s.saleMode === 'exchange' ? 'Troca' : 'Casco novo'})`,
      `${PAYMENT_METHOD_LABELS[s.paymentMethod] ?? s.paymentMethod}\n${
        s.paymentStatus === 'paid' ? 'Pago' : 'Em Aberto'
      }`,
      DELIVERY_STATUS_LABELS[s.deliveryStatus],
      s.fulfillmentType === 'pickup' ? 'Balcão' : s.driverName || '—',
      formatCurrency(s.totalAmount, currency),
      s.deliveryStatus === 'cancelled'
        ? '—'
        : formatCurrency(getSaleProfit(s), currency),
    ]);

    autoTable(doc, {
      startY: 42,
      margin: { left: margin, right: margin, bottom: 16 },
      head: [
        [
          'Pedido',
          'Data / Hora',
          'Cliente',
          'Item / Modalidade',
          'Pagamento',
          'Entrega',
          'Entregador',
          'Total',
          'Lucro Est.',
        ],
      ],
      body: tableRows,
      foot: [
        [
          'Totais Ativos',
          '',
          '',
          `${filteredSummary.totalUnits} botijões`,
          '',
          '',
          '',
          formatCurrency(filteredSummary.totalValue, currency),
          formatCurrency(filteredSummary.cylindersProfit, currency),
        ],
      ],
      showFoot: 'lastPage',
      theme: 'striped',
      styles: {
        font: 'helvetica',
        fontSize: 8.2,
        cellPadding: 2.5,
        textColor: [30, 41, 59],
        valign: 'middle',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.2,
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 8.4,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 28 },
        7: { halign: 'right', fontStyle: 'bold', cellWidth: 26 },
        8: { halign: 'right', fontStyle: 'bold', cellWidth: 26 },
      },
    });

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(depotName, margin, pageHeight - 8);
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, {
        align: 'right',
      });
    }

    doc.save(`relatorio-vendas-${getPeriodSuffix()}.pdf`);
  };

  const handleExportProfitExtractPdf = () => {
    const activeSales = filteredSales.filter((s) => s.deliveryStatus !== 'cancelled');
    const includeExpenses = !hasNarrowFilter && periodExpenses > 0;
    if (activeSales.length === 0 && !includeExpenses) return;

    const getCylinderSortWeight = (code: string, weightKg?: number): number => {
      const upper = code.trim().toUpperCase();
      const prefix = upper.charAt(0);
      const tier = prefix === 'P' ? 1 : prefix === 'M' ? 2 : prefix === 'G' ? 3 : 4;
      const numMatch = upper.match(/\d+/);
      const num = weightKg && weightKg > 0 ? weightKg : numMatch ? Number(numMatch[0]) : 999;
      return tier * 10000 + num;
    };

    const cylinderSortMap = new Map<string, number>();
    for (const cyl of cylinders) {
      const code = cyl.code.trim().toUpperCase();
      if (code) {
        cylinderSortMap.set(code, getCylinderSortWeight(code, cyl.weightKg));
      }
    }
    for (const s of activeSales) {
      const code = s.cylinderCode.trim().toUpperCase();
      if (code && !cylinderSortMap.has(code)) {
        cylinderSortMap.set(code, getCylinderSortWeight(code));
      }
    }

    const cylinderCodes = Array.from(cylinderSortMap.keys()).sort(
      (a, b) => (cylinderSortMap.get(a)! - cylinderSortMap.get(b)!) || a.localeCompare(b)
    );

    interface DailyProfitGroup {
      dateKey: string;
      profitByCode: Record<string, number>;
      unitsByCode: Record<string, number>;
      dailyTotalProfit: number;
    }

    const dailyMap = new Map<string, DailyProfitGroup>();
    const ensureDay = (dateKey: string): DailyProfitGroup => {
      let existing = dailyMap.get(dateKey);
      if (!existing) {
        existing = {
          dateKey,
          profitByCode: {},
          unitsByCode: {},
          dailyTotalProfit: 0,
        };
        dailyMap.set(dateKey, existing);
      }
      return existing;
    };

    const totalProfitByCode: Record<string, number> = {};
    for (const code of cylinderCodes) {
      totalProfitByCode[code] = 0;
    }

    for (const s of activeSales) {
      const dateKey = toInputDate(getRecordDate(s));
      const day = ensureDay(dateKey);
      const code = s.cylinderCode.trim().toUpperCase();
      const profit = getSaleProfit(s);

      day.profitByCode[code] = (day.profitByCode[code] ?? 0) + profit;
      day.unitsByCode[code] = (day.unitsByCode[code] ?? 0) + s.quantity;
      day.dailyTotalProfit += profit;

      totalProfitByCode[code] = (totalProfitByCode[code] ?? 0) + profit;
    }

    if (activeSales.length === 0 && includeExpenses) {
      for (const exp of expenses) {
        const ms = getRecordMillis(exp);
        if (ms < dateBounds.start || ms > dateBounds.end) continue;
        ensureDay(toInputDate(getRecordDate(exp)));
      }
    }

    const sortedDays = Array.from(dailyMap.values()).sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey)
    );
    if (sortedDays.length === 0) return;

    const doc = new jsPDF({
      orientation: cylinderCodes.length > 4 ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    const statusLabel =
      statusFilter === 'all' ? 'Todos' : DELIVERY_STATUS_LABELS[statusFilter];
    const generatedAt = new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(depotName, margin, 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('Mini Extrato de Lucros Agrupados por Data', margin, 21.5);

    doc.setFontSize(8.5);
    doc.text(`Período: ${getPeriodLabel()}`, pageWidth - margin, 15.5, { align: 'right' });
    doc.text(`Status: ${statusLabel}  |  Emitido: ${generatedAt}`, pageWidth - margin, 21, {
      align: 'right',
    });

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, 25, pageWidth - margin, 25);

    // Summary line
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    const summaryLine1 = [
      `Dias: ${sortedDays.length}`,
      `Pedidos: ${filteredSummary.activeCount}`,
      `Botijões: ${filteredSummary.totalUnits}`,
      `Bruto: ${formatCurrency(filteredSummary.totalValue, currency)}`,
    ].join('   •   ');
    doc.text(summaryLine1, margin, 31);

    const summaryLine2 = [
      `Custo (CMV): ${formatCurrency(filteredSummary.totalCost, currency)}`,
      `Lucro Botijas: ${formatCurrency(filteredSummary.cylindersProfit, currency)}`,
      ...(includeExpenses
        ? [`Despesas: ${formatCurrency(periodExpenses, currency)}`]
        : []),
      `Líquido Est.: ${formatCurrency(filteredSummary.estimatedNetResult, currency)}`,
    ].join('   •   ');

    if (filteredSummary.estimatedNetResult >= 0) {
      doc.setTextColor(4, 120, 87);
    } else {
      doc.setTextColor(185, 28, 28);
    }
    doc.text(summaryLine2, margin, 36.5);
    doc.setTextColor(15, 23, 42);

    const weekdayShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const formatDateWithDay = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1);
      const wd = weekdayShort[dt.getDay()] ?? '';
      return `${formatBrDate(iso)} (${wd})`;
    };

    const headRow = [
      ['Data', ...cylinderCodes.map((code) => `Lucro de ${code}`), 'Total diário'],
    ];

    const bodyRows = sortedDays.map((day) => [
      formatDateWithDay(day.dateKey),
      ...cylinderCodes.map((code) =>
        (day.unitsByCode[code] ?? 0) > 0
          ? formatCurrency(day.profitByCode[code] ?? 0, currency)
          : '—'
      ),
      formatCurrency(day.dailyTotalProfit, currency),
    ]);

    const footRow = [
      [
        `Total (${sortedDays.length} dias)`,
        ...cylinderCodes.map((code) => formatCurrency(totalProfitByCode[code] ?? 0, currency)),
        formatCurrency(filteredSummary.cylindersProfit, currency),
      ],
    ];

    const dynamicColumnStyles: Record<
      number,
      { halign?: 'left' | 'right' | 'center'; cellWidth?: number; fontStyle?: 'bold' | 'normal' }
    > = {
      0: { cellWidth: 34, halign: 'left' },
    };
    cylinderCodes.forEach((_, idx) => {
      dynamicColumnStyles[idx + 1] = { halign: 'right' };
    });
    dynamicColumnStyles[cylinderCodes.length + 1] = { halign: 'right', fontStyle: 'bold' };

    autoTable(doc, {
      startY: 41,
      margin: { left: margin, right: margin, bottom: 16 },
      head: headRow,
      body: bodyRows,
      foot: footRow,
      showFoot: 'lastPage',
      theme: 'striped',
      styles: {
        font: 'helvetica',
        fontSize: cylinderCodes.length > 4 ? 8 : 8.8,
        cellPadding: 2.6,
        textColor: [30, 41, 59],
        valign: 'middle',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: cylinderCodes.length > 4 ? 8 : 8.8,
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: cylinderCodes.length > 4 ? 8.2 : 9,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: dynamicColumnStyles,
      didParseCell: (data) => {
        if (data.section === 'head' || data.section === 'foot') {
          data.cell.styles.halign = data.column.index === 0 ? 'left' : 'right';
        }
      },
    });

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`${depotName} · Mini Extrato de Lucros`, margin, pageHeight - 8);
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, {
        align: 'right',
      });
    }

    doc.save(`mini-extrato-lucros-${getPeriodSuffix()}.pdf`);
  };

  const handleStatusChange = async (
    sale: Sale,
    nextStatus: DeliveryStatus,
    driverOverride?: string
  ) => {
    setBusyId(sale.id);
    try {
      const cyl = cylinders.find((c) => c.id === sale.cylinderId);
      const cust = customers.find((c) => c.id === sale.customerId);
      await updateSaleDelivery(
        uid,
        sale,
        nextStatus,
        driverOverride ?? sale.driverName,
        cyl,
        cust
      );
      setSelectedSale((prev) =>
        prev && prev.id === sale.id
          ? { ...prev, deliveryStatus: nextStatus, driverName: driverOverride ?? prev.driverName }
          : prev
      );
    } finally {
      setBusyId(null);
      setCancelTarget(null);
    }
  };

  const handleMarkPaid = async (sale: Sale) => {
    setBusyId(sale.id);
    try {
      const cust = customers.find((c) => c.id === sale.customerId);
      await markSalePaid(uid, sale, cust);
      setSelectedSale((prev) =>
        prev && prev.id === sale.id ? { ...prev, paymentStatus: 'paid' } : prev
      );
    } finally {
      setBusyId(null);
    }
  };

  const filterTabs: { id: 'all' | DeliveryStatus; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'Pendentes' },
    { id: 'in_route', label: 'Em Rota' },
    { id: 'delivered', label: 'Entregues' },
    { id: 'cancelled', label: 'Cancelados' },
  ];

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pedido, cliente, endereço ou entregador..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Filtrar por período"
              value={period}
              onChange={(e) => setPeriod(e.target.value as SalesPeriod)}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:border-orange-600"
            >
              <option value="this_month">Este Mês</option>
              <option value="last_month">Mês Anterior</option>
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 Dias</option>
              <option value="all">Todos os Períodos</option>
              <option value="custom">Período Personalizado</option>
            </select>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={filteredSales.length === 0}
              className="h-10 px-4 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Exportar PDF</span>
            </button>

            {permissions.viewFinance && (
              <button
                type="button"
                onClick={handleExportProfitExtractPdf}
                disabled={filteredSummary.activeCount === 0 && (hasNarrowFilter || periodExpenses === 0)}
                className="h-10 px-3.5 rounded-lg border border-emerald-300 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-950/70 disabled:opacity-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Extrato Lucros (PDF)</span>
              </button>
            )}
          </div>
        </div>

        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">De:</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomStart(val);
                  if (val && customEnd && val > customEnd) {
                    setCustomEnd(val);
                  }
                }}
                className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Até:</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomEnd(val);
                  if (val && customStart && val < customStart) {
                    setCustomStart(val);
                  }
                }}
                className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Lista</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'map'
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>Mapa de Rotas</span>
              </button>
            </div>

            {viewMode === 'list' && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{filteredSummary.count} pedidos</span>
            <span aria-hidden="true">·</span>
            <span>{filteredSummary.totalUnits} botijões</span>
            <span aria-hidden="true">·</span>
            <span>
              Bruto:{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(filteredSummary.totalValue, currency)}
              </span>
            </span>
            {permissions.viewFinance && (
              <>
                <span aria-hidden="true">·</span>
                <span title="Resultado Líquido Estimado">
                  Lucro:{' '}
                  <span
                    className={`font-semibold ${
                      filteredSummary.estimatedNetResult >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {formatCurrency(filteredSummary.estimatedNetResult, currency)}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delivery Route Map View or Table */}
      {viewMode === 'map' ? (
        <DeliveryRouteMap
          uid={uid}
          depotName={depotName}
          currency={currency}
          sales={periodAndSearchSales}
          customers={customers}
          drivers={drivers}
          busyId={busyId}
          onStatusChange={handleStatusChange}
          onSelectSale={setSelectedSale}
          canManageDeliveries={permissions.manageDeliveries}
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filteredSales.length === 0 ? (
          <div className="py-14 text-center px-6">
            <p className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Nenhum pedido encontrado
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Ajuste os filtros ou registre uma nova venda no PDV.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Pedido / Data</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Botijão</th>
                  <th className="py-3 px-4">Entregador</th>
                  <th className="py-3 px-4">Pagamento</th>
                  <th className="py-3 px-4">Entrega</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filteredSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {sale.orderNumber}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(getRecordTimestamp(sale))}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{sale.customerName}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                        {sale.deliveryAddress || 'Balcão'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {sale.quantity}x {sale.cylinderCode}
                      <span className="text-slate-400 dark:text-slate-600"> · </span>
                      {sale.saleMode === 'exchange' ? 'Troca' : 'Com casco'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300">
                      {sale.fulfillmentType === 'pickup' ? (
                        <span className="text-slate-500 dark:text-slate-400">Balcão</span>
                      ) : permissions.manageDeliveries &&
                        (sale.deliveryStatus === 'pending' || sale.deliveryStatus === 'in_route') ? (
                        <select
                          aria-label={`Entregador do pedido ${sale.orderNumber}`}
                          disabled={busyId === sale.id}
                          value={sale.driverName}
                          onChange={(e) =>
                            handleStatusChange(sale, sale.deliveryStatus, e.target.value)
                          }
                          className="h-8 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-orange-600"
                        >
                          <option value="">A definir</option>
                          {drivers.map((drv) => (
                            <option key={drv} value={drv}>
                              {drv}
                            </option>
                          ))}
                        </select>
                      ) : (
                        sale.driverName || '—'
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        {PAYMENT_METHOD_LABELS[sale.paymentMethod]}
                      </div>
                      <PaymentStatusLabel status={sale.paymentStatus} />
                    </td>
                    <td className="py-3 px-4">
                      <DeliveryStatusLabel status={sale.deliveryStatus} />
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(sale.totalAmount, currency)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {permissions.manageDeliveries && sale.deliveryStatus === 'pending' && (
                          <button
                            type="button"
                            disabled={busyId === sale.id}
                            onClick={() => handleStatusChange(sale, 'in_route')}
                            title="Iniciar entrega"
                            className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Truck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            <span>Despachar</span>
                          </button>
                        )}
                        {permissions.manageDeliveries && sale.deliveryStatus === 'in_route' && (
                          <button
                            type="button"
                            disabled={busyId === sale.id}
                            onClick={() => handleStatusChange(sale, 'delivered')}
                            className="px-2.5 py-1.5 rounded-md bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Entregar</span>
                          </button>
                        )}
                        {(permissions.manageDeliveries || permissions.manageCustomers) &&
                          sale.deliveryStatus !== 'cancelled' &&
                          sale.paymentStatus === 'pending' && (
                          <button
                            type="button"
                            disabled={busyId === sale.id}
                            onClick={() => handleMarkPaid(sale)}
                            className="px-2.5 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 cursor-pointer whitespace-nowrap"
                          >
                            Quitar
                          </button>
                        )}
                        {sale.deliveryStatus === 'delivered' && (
                          <button
                            type="button"
                            onClick={() => setReceiptSale(sale)}
                            className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                            <span>Imprimir Recibo</span>
                          </button>
                        )}
                        {permissions.manageDeliveries &&
                          (sale.deliveryStatus === 'pending' || sale.deliveryStatus === 'in_route') && (
                          <button
                            type="button"
                            disabled={busyId === sale.id}
                            onClick={() => setCancelTarget(sale)}
                            title="Cancelar pedido"
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedSale(sale)}
                          title="Ver detalhes"
                          className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      )}

      {/* Sale Detail Drawer */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex justify-end">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md h-full p-6 overflow-y-auto flex flex-col justify-between border-l border-slate-200 dark:border-slate-800">
            <div className="space-y-6">
              <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{selectedSale.orderNumber}</p>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    Detalhes da Venda
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSale(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Data e Hora</dt>
                  <dd className="font-mono text-xs text-slate-900 dark:text-slate-100">
                    {formatDateTime(getRecordTimestamp(selectedSale))}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Cliente</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">{selectedSale.customerName}</dd>
                </div>
                {selectedSale.customerPhone && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Telefone</dt>
                    <dd className="font-mono text-xs text-slate-900 dark:text-slate-100">{selectedSale.customerPhone}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">Endereço</dt>
                  <dd className="text-right text-slate-900 dark:text-slate-100">
                    {selectedSale.deliveryAddress || 'Retirada no balcão'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Status da Entrega</dt>
                  <dd>
                    <DeliveryStatusLabel status={selectedSale.deliveryStatus} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Pagamento</dt>
                  <dd className="text-right">
                    <span className="text-slate-900 dark:text-slate-100 font-medium">
                      {PAYMENT_METHOD_LABELS[selectedSale.paymentMethod]}
                    </span>
                    <div className="mt-0.5">
                      <PaymentStatusLabel status={selectedSale.paymentStatus} />
                    </div>
                  </dd>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">
                    {selectedSale.quantity}x {selectedSale.cylinderCode} (
                    {selectedSale.saleMode === 'exchange' ? 'Troca' : 'Casco novo'})
                  </dt>
                  <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(selectedSale.unitPrice * selectedSale.quantity, currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Taxa de Entrega</dt>
                  <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(selectedSale.deliveryFee, currency)}
                  </dd>
                </div>
                {selectedSale.discount > 0 && (
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                    <dt>Desconto</dt>
                    <dd className="font-mono tabular-nums">
                      - {formatCurrency(selectedSale.discount, currency)}
                    </dd>
                  </div>
                )}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-baseline">
                  <dt className="font-semibold text-slate-900 dark:text-slate-100">Total Final</dt>
                  <dd className="font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
                    {formatCurrency(selectedSale.totalAmount, currency)}
                  </dd>
                </div>
                {permissions.viewFinance && selectedSale.deliveryStatus !== 'cancelled' && (
                  <div className="flex justify-between text-xs">
                    <dt className="text-slate-500 dark:text-slate-400">
                      Lucro estimado (CMV {formatCurrency(getSaleCost(selectedSale), currency)})
                    </dt>
                    <dd
                      className={`font-mono tabular-nums font-semibold ${
                        getSaleProfit(selectedSale) >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {formatCurrency(getSaleProfit(selectedSale), currency)}
                    </dd>
                  </div>
                )}
                {selectedSale.notes && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                    <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Observações</dt>
                    <dd className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      {selectedSale.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="space-y-2.5 pt-4">
              {selectedSale.deliveryStatus === 'delivered' && (
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedSale;
                    setSelectedSale(null);
                    setReceiptSale(target);
                  }}
                  className="w-full py-2.5 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-sm font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir Recibo</span>
                </button>
              )}
              {(permissions.manageDeliveries || permissions.manageSettings || permissions.viewFinance) && (
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedSale;
                    setSelectedSale(null);
                    setDeleteTarget(target);
                  }}
                  className="w-full py-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/30 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-100/70 dark:hover:bg-red-950/60 inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Descartar / Excluir Registro</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedSale(null)}
                className="w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Receipt Modal */}
      {receiptSale && (
        <ReceiptModal
          sale={receiptSale}
          depotName={depotName}
          currency={currency}
          onClose={() => setReceiptSale(null)}
        />
      )}

      {/* Cancel Confirmation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Cancelar Pedido {cancelTarget.orderNumber}?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Ao cancelar, {cancelTarget.quantity}x {cancelTarget.cylinderCode} serão estornados automaticamente para o estoque de botijões cheios.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={busyId === cancelTarget.id}
                onClick={() => handleStatusChange(cancelTarget, 'cancelled')}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busyId === cancelTarget.id ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Excluir Registro {deleteTarget.orderNumber}?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Esta ação remove apenas o registro da venda ({deleteTarget.quantity}x {deleteTarget.cylinderCode}) sem alterar o estoque atual do pátio.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={busyId === deleteTarget.id}
                onClick={async () => {
                  setBusyId(deleteTarget.id);
                  try {
                    await deleteSaleRecord(uid, deleteTarget.id);
                    setDeleteTarget(null);
                  } finally {
                    setBusyId(null);
                  }
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busyId === deleteTarget.id ? 'Excluindo...' : 'Excluir Registro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
