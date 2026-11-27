import { ArrowRight, Package, Plus, TrendingUp, Truck, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import cylinderStudioImg from '../assets/images/gas_cylinder_studio_1794631289411.jpg';
import { formatCurrency, formatDateTime, getRecordDate, getRecordMillis, getRecordTimestamp } from '../lib/formatters';
import { updateSaleDelivery } from '../services/depotService';
import {
  type AppSection,
  type CurrencyCode,
  type Customer,
  type Cylinder,
  type DeliveryStatus,
  type MemberPermissions,
  type Sale,
} from '../types/gas';
import { DeliveryStatusLabel, StockHealthLabel } from './StatusLabel';

interface DashboardViewProps {
  uid: string;
  currency: CurrencyCode;
  cylinders: Cylinder[];
  sales: Sale[];
  customers: Customer[];
  permissions: MemberPermissions;
  onNavigate: (section: AppSection) => void;
}

export function DashboardView({
  uid,
  currency,
  cylinders,
  sales,
  customers,
  permissions,
  onNavigate,
}: DashboardViewProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const activeSales = sales.filter((s) => s.deliveryStatus !== 'cancelled');
    const todaySales = activeSales.filter((s) => {
      const ts = getRecordMillis(s);
      return ts >= startOfToday;
    });

    const todayRevenue = todaySales.reduce((acc, s) => acc + s.totalAmount, 0);
    const todayUnits = todaySales.reduce((acc, s) => acc + s.quantity, 0);
    const openDeliveries = sales.filter(
      (s) => s.deliveryStatus === 'pending' || s.deliveryStatus === 'in_route'
    );
    const totalFull = cylinders.reduce((acc, c) => acc + c.fullCount, 0);
    const totalEmpty = cylinders.reduce((acc, c) => acc + c.emptyCount, 0);
    const totalReceivable = sales
      .filter((s) => s.deliveryStatus !== 'cancelled' && s.paymentStatus === 'pending')
      .reduce((acc, s) => acc + s.totalAmount, 0);

    return {
      todayRevenue,
      todayCount: todaySales.length,
      todayUnits,
      openDeliveries,
      totalFull,
      totalEmpty,
      totalReceivable,
    };
  }, [sales, cylinders]);

  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(6);

  const last7Days = useMemo(() => {
    const cylinderCostMap = new Map(cylinders.map((c) => [c.id, c.costPrice]));
    const days: {
      key: string;
      label: string;
      dateLabel: string;
      revenue: number;
      profit: number;
      units: number;
    }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      const dateLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      days.push({
        key,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        dateLabel,
        revenue: 0,
        profit: 0,
        units: 0,
      });
    }

    for (const sale of sales) {
      if (sale.deliveryStatus === 'cancelled') continue;
      const date = getRecordDate(sale);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const bucket = days.find((d) => d.key === key);
      if (bucket) {
        const unitCost =
          sale.unitCost > 0 ? sale.unitCost : (cylinderCostMap.get(sale.cylinderId) ?? 0);
        const saleProfit = sale.totalAmount - unitCost * sale.quantity;
        bucket.revenue += sale.totalAmount;
        bucket.profit += saleProfit;
        bucket.units += sale.quantity;
      }
    }
    return days;
  }, [sales, cylinders]);

  const chartSummary = useMemo(() => {
    const totalRevenue = last7Days.reduce((acc, d) => acc + d.revenue, 0);
    const totalProfit = last7Days.reduce((acc, d) => acc + d.profit, 0);
    const totalUnits = last7Days.reduce((acc, d) => acc + d.units, 0);

    const maxVal = Math.max(
      100,
      ...last7Days.map((d) => Math.max(d.revenue, d.profit))
    );
    const minVal = Math.min(
      0,
      ...last7Days.map((d) => Math.min(d.revenue, d.profit))
    );

    const svgWidth = 700;
    const svgHeight = 190;
    const topPad = 20;
    const bottomPad = 16;
    const plotHeight = svgHeight - topPad - bottomPad;
    const range = maxVal - minVal > 0 ? maxVal - minVal : 100;

    const getY = (val: number) => topPad + ((maxVal - val) / range) * plotHeight;
    const zeroY = getY(0);

    const revenuePoints = last7Days.map((d, idx) => ({
      x: idx * 100 + 50,
      y: getY(d.revenue),
    }));
    const profitPoints = last7Days.map((d, idx) => ({
      x: idx * 100 + 50,
      y: getY(d.profit),
    }));

    const buildSmoothLine = (pts: { x: number; y: number }[]) => {
      if (pts.length === 0) return '';
      return pts.reduce((path, pt, i) => {
        if (i === 0) return `M ${pt.x} ${pt.y}`;
        const prev = pts[i - 1];
        const midX = (prev.x + pt.x) / 2;
        return `${path} C ${midX} ${prev.y}, ${midX} ${pt.y}, ${pt.x} ${pt.y}`;
      }, '');
    };

    const buildAreaPath = (pts: { x: number; y: number }[], baselineY: number) => {
      if (pts.length === 0) return '';
      const line = buildSmoothLine(pts);
      const last = pts[pts.length - 1];
      const first = pts[0];
      return `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
    };

    return {
      totalRevenue,
      totalProfit,
      totalUnits,
      minVal,
      maxVal,
      svgWidth,
      svgHeight,
      topPad,
      plotHeight,
      zeroY,
      revenuePoints,
      profitPoints,
      revenuePath: buildSmoothLine(revenuePoints),
      profitPath: buildSmoothLine(profitPoints),
      revenueAreaPath: buildAreaPath(revenuePoints, zeroY),
      profitAreaPath: buildAreaPath(profitPoints, zeroY),
    };
  }, [last7Days]);

  const activeDay = last7Days[selectedDayIdx] ?? last7Days[last7Days.length - 1];

  const formatCompactMoney = (value: number) => {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    const suffix = currency === 'MZN' ? ' MT' : currency === 'EUR' ? ' €' : '';
    const prefix = currency === 'BRL' ? 'R$' : '';
    if (abs >= 1_000_000) {
      return `${sign}${prefix}${(abs / 1_000_000).toFixed(1).replace('.', ',')}M${suffix}`;
    }
    if (abs >= 1_000) {
      return `${sign}${prefix}${(abs / 1_000).toFixed(1).replace('.', ',')}k${suffix}`;
    }
    return `${sign}${prefix}${Math.round(abs)}${suffix}`;
  };

  const handleAdvanceStatus = async (sale: Sale, nextStatus: DeliveryStatus) => {
    setUpdatingId(sale.id);
    try {
      const cyl = cylinders.find((c) => c.id === sale.cylinderId);
      const cust = customers.find((c) => c.id === sale.customerId);
      await updateSaleDelivery(uid, sale, nextStatus, sale.driverName, cyl, cust);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Faturamento Hoje</p>
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2">
              {formatCurrency(metrics.todayRevenue, currency)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
              {metrics.todayCount} pedidos · {metrics.todayUnits} botijões
            </p>
          </div>
          <div
            aria-hidden="true"
            className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0"
          >
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Botijões no Pátio</p>
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2">
              {metrics.totalFull}{' '}
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">cheios</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
              {metrics.totalEmpty} cascos vazios disponíveis
            </p>
          </div>
          <div
            aria-hidden="true"
            className="w-11 h-11 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 flex items-center justify-center shrink-0"
          >
            <Package className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Entregas em Aberto</p>
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2">
              {metrics.openDeliveries.length}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {metrics.openDeliveries.filter((d) => d.deliveryStatus === 'in_route').length} em rota neste momento
            </p>
          </div>
          <div
            aria-hidden="true"
            className="w-11 h-11 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0"
          >
            <Truck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Saldo a Receber (Fiado)</p>
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2">
              {formatCurrency(metrics.totalReceivable, currency)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Pedidos entregues aguardando quitação
            </p>
          </div>
          <div
            aria-hidden="true"
            className="w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0"
          >
            <Wallet className="w-5 h-5" />
          </div>
        </div>
      </section>

      {/* Main Grid: Revenue Chart + Stock Status */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Receita e Lucro dos Últimos 7 Dias
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pedidos ativos excluindo cancelamentos · Passe ou toque em um dia para detalhar
                </p>
              </div>
              {permissions.viewFinance && (
                <button
                  type="button"
                  onClick={() => onNavigate('finance')}
                  className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Ver financeiro</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 7-day Totals & Selected Day Inspection Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 pb-2">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-600 shrink-0" />
                  <span className="text-slate-500 dark:text-slate-400">Receita (7d):</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(chartSummary.totalRevenue, currency)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                  <span className="text-slate-500 dark:text-slate-400">Lucro (7d):</span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      chartSummary.totalProfit >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatCurrency(chartSummary.totalProfit, currency)}
                  </span>
                </div>
              </div>

              {activeDay && (
                <div className="text-[11px] font-mono tabular-nums bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 rounded-lg px-2.5 py-1 text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedDayIdx === 6 ? 'Hoje' : activeDay.label} ({activeDay.dateLabel})
                  </span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span>Rec: {formatCurrency(activeDay.revenue, currency)}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span
                    className={`font-semibold ${
                      activeDay.profit >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    Lucro: {formatCurrency(activeDay.profit, currency)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2">
            {/* SVG Line Chart */}
            <div className="relative w-full">
              <svg
                viewBox={`0 0 ${chartSummary.svgWidth} ${chartSummary.svgHeight}`}
                className="w-full h-44 overflow-visible"
                role="img"
                aria-label="Gráfico de linhas de receita e lucro dos últimos 7 dias"
              >
                <defs>
                  <linearGradient id="dashRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ea580c" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#ea580c" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="dashProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {[0, 0.5, 1].map((ratio) => {
                  const y = chartSummary.topPad + ratio * chartSummary.plotHeight;
                  return (
                    <line
                      key={ratio}
                      x1={20}
                      y1={y}
                      x2={chartSummary.svgWidth - 20}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Zero Baseline when negative profits exist */}
                {chartSummary.minVal < 0 && (
                  <line
                    x1={20}
                    y1={chartSummary.zeroY}
                    x2={chartSummary.svgWidth - 20}
                    y2={chartSummary.zeroY}
                    stroke="currentColor"
                    className="text-slate-300 dark:text-slate-700"
                    strokeWidth="1.2"
                  />
                )}

                {/* Vertical Active Day Guide */}
                {chartSummary.revenuePoints[selectedDayIdx] && (
                  <line
                    x1={chartSummary.revenuePoints[selectedDayIdx].x}
                    y1={chartSummary.topPad - 4}
                    x2={chartSummary.revenuePoints[selectedDayIdx].x}
                    y2={chartSummary.svgHeight - 8}
                    stroke="currentColor"
                    className="text-slate-300 dark:text-slate-700"
                    strokeDasharray="3 3"
                    strokeWidth="1.2"
                  />
                )}

                {/* Area Fills */}
                <path d={chartSummary.revenueAreaPath} fill="url(#dashRevenueGrad)" />
                <path d={chartSummary.profitAreaPath} fill="url(#dashProfitGrad)" />

                {/* Revenue Line */}
                <path
                  d={chartSummary.revenuePath}
                  fill="none"
                  stroke="#ea580c"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Profit Line */}
                <path
                  d={chartSummary.profitPath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Data Points & Hit Areas */}
                {last7Days.map((day, idx) => {
                  const revPt = chartSummary.revenuePoints[idx];
                  const profPt = chartSummary.profitPoints[idx];
                  const isActive = idx === selectedDayIdx;
                  const profitNegative = day.profit < 0;

                  return (
                    <g
                      key={day.key}
                      className="cursor-pointer"
                      onMouseEnter={() => setSelectedDayIdx(idx)}
                      onClick={() => setSelectedDayIdx(idx)}
                    >
                      {/* Wide column hover/tap hit area */}
                      <rect
                        x={idx * 100}
                        y={0}
                        width={100}
                        height={chartSummary.svgHeight}
                        fill="transparent"
                      />

                      {/* Revenue Point */}
                      {isActive && (
                        <circle
                          cx={revPt.x}
                          cy={revPt.y}
                          r={8}
                          fill="#ea580c"
                          fillOpacity="0.18"
                        />
                      )}
                      <circle
                        cx={revPt.x}
                        cy={revPt.y}
                        r={isActive ? 4.5 : 3.2}
                        fill="#ea580c"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />

                      {/* Profit Point */}
                      {isActive && (
                        <circle
                          cx={profPt.x}
                          cy={profPt.y}
                          r={9}
                          fill={profitNegative ? '#ef4444' : '#10b981'}
                          fillOpacity="0.2"
                        />
                      )}
                      <circle
                        cx={profPt.x}
                        cy={profPt.y}
                        r={isActive ? 5 : 3.5}
                        fill={profitNegative ? '#ef4444' : '#10b981'}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Aligned 7-Day X-Axis with Profit & Units */}
            <div className="grid grid-cols-7 gap-1 pt-2 border-t border-slate-100 dark:border-slate-800">
              {last7Days.map((day, idx) => {
                const isToday = idx === last7Days.length - 1;
                const isActive = idx === selectedDayIdx;
                return (
                  <button
                    key={day.key}
                    type="button"
                    onMouseEnter={() => setSelectedDayIdx(idx)}
                    onClick={() => setSelectedDayIdx(idx)}
                    className={`flex flex-col items-center py-1.5 px-0.5 rounded-lg transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-slate-100/90 dark:bg-slate-800/80'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <span
                      className={`text-xs ${
                        isToday || isActive
                          ? 'font-semibold text-slate-900 dark:text-slate-100'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {day.label}
                    </span>
                    <span
                      className={`text-[10px] sm:text-[11px] font-mono tabular-nums font-semibold truncate max-w-full mt-0.5 ${
                        day.profit > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : day.profit < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {formatCompactMoney(day.profit)}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500">
                      {day.units > 0 ? `${day.units}un` : '0'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Estoque de Botijões
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Cheios disponíveis vs. cascos vazios
              </p>
            </div>
            {permissions.viewInventory && (
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Gerenciar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3">Tipo</th>
                  <th className="py-2.5 px-3 text-right">Cheios</th>
                  <th className="py-2.5 px-3 text-right">Vazios</th>
                  <th className="py-2.5 pl-3 text-right">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {cylinders.map((cyl) => (
                  <tr key={cyl.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden shrink-0">
                          <img
                            src={cyl.imageUrl || cylinderStudioImg}
                            alt={cyl.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">{cyl.code}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {formatCurrency(cyl.salePrice, currency)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {cyl.fullCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {cyl.emptyCount}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <div className="inline-flex justify-end">
                        <StockHealthLabel fullCount={cyl.fullCount} minStock={cyl.minStock} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Active Delivery Queue or Empty State */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Fila de Entregas e Últimos Pedidos
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Acompanhamento rápido de pedidos pendentes e em rota
            </p>
          </div>
          <div className="flex items-center gap-3">
            {permissions.viewSales && (
              <button
                type="button"
                onClick={() => onNavigate('sales')}
                className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Ver histórico completo
              </button>
            )}
            {permissions.createSales && (
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Venda</span>
              </button>
            )}
          </div>
        </div>

        {sales.length === 0 ? (
          <div className="py-14 text-center max-w-md mx-auto">
            <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Package className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Nenhuma venda registrada ainda
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Seu estoque inicial de botijões P8, P13, P20 e P45 já está pronto. Registre a primeira venda no balcão ou delivery.
            </p>
            {permissions.createSales && (
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-sm font-medium hover:bg-slate-800 dark:hover:bg-orange-700 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar Primeira Venda</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-4">Pedido</th>
                  <th className="py-2.5 px-4">Cliente / Endereço</th>
                  <th className="py-2.5 px-4">Item</th>
                  <th className="py-2.5 px-4">Entregador</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Total</th>
                  <th className="py-2.5 pl-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {sales.slice(0, 8).map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {sale.orderNumber}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(getRecordTimestamp(sale))}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {sale.customerName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
                        {sale.deliveryAddress || 'Retirada no balcão'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                      {sale.quantity}x {sale.cylinderCode}
                      <span className="text-slate-400 dark:text-slate-600"> · </span>
                      {sale.saleMode === 'exchange' ? 'Troca' : 'Com casco'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                      {sale.fulfillmentType === 'pickup' ? 'Balcão' : sale.driverName || 'Não definido'}
                    </td>
                    <td className="py-3 px-4">
                      <DeliveryStatusLabel status={sale.deliveryStatus} />
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(sale.totalAmount, currency)}
                    </td>
                    <td className="py-3 pl-4 text-right">
                      {permissions.manageDeliveries && sale.deliveryStatus === 'pending' && (
                        <button
                          type="button"
                          disabled={updatingId === sale.id}
                          onClick={() => handleAdvanceStatus(sale, 'in_route')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                        >
                          <Truck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          <span>Despachar</span>
                        </button>
                      )}
                      {permissions.manageDeliveries && sale.deliveryStatus === 'in_route' && (
                        <button
                          type="button"
                          disabled={updatingId === sale.id}
                          onClick={() => handleAdvanceStatus(sale, 'delivered')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                        >
                          <span>Confirmar Entrega</span>
                        </button>
                      )}
                      {(!permissions.manageDeliveries ||
                        sale.deliveryStatus === 'delivered' ||
                        sale.deliveryStatus === 'cancelled') && (
                        <span className="text-xs text-slate-400 dark:text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
