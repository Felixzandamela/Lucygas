import { BarChart3, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatCurrency } from '../lib/formatters';
import type { CurrencyCode, Expense, Sale } from '../types/gas';

interface MonthlyProfitChartProps {
  currency: CurrencyCode;
  sales: Sale[];
  expenses: Expense[];
  onAddExpense: () => void;
}

interface MonthBucket {
  key: string;
  shortLabel: string;
  fullLabel: string;
  revenue: number;
  cogs: number;
  expenses: number;
  netProfit: number;
  units: number;
  salesCount: number;
  marginPct: number;
  momDeltaPct: number | null;
  prevLabel: string | null;
}

type ChartCompareMode = 'profit' | 'revenue_vs_profit';

function formatCompactMoney(value: number, currency: CurrencyCode): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const suffix = currency === 'MZN' ? ' MT' : currency === 'EUR' ? ' €' : '';
  const prefix = currency === 'BRL' ? 'R$ ' : '';

  if (abs >= 1_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000).toFixed(1).replace('.', ',')}M${suffix}`;
  }
  if (abs >= 1_000) {
    return `${sign}${prefix}${(abs / 1_000).toFixed(1).replace('.', ',')}k${suffix}`;
  }
  return `${sign}${prefix}${Math.round(abs)}${suffix}`;
}

export function MonthlyProfitChart({
  currency,
  sales,
  expenses,
  onAddExpense,
}: MonthlyProfitChartProps) {
  const [compareMode, setCompareMode] = useState<ChartCompareMode>('profit');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const monthsData = useMemo<MonthBucket[]>(() => {
    const now = new Date();
    const buckets: MonthBucket[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rawShort = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const shortYear = String(d.getFullYear()).slice(-2);
      const shortLabel = `${rawShort.charAt(0).toUpperCase()}${rawShort.slice(1)}/${shortYear}`;
      const rawFull = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const fullLabel = `${rawFull.charAt(0).toUpperCase()}${rawFull.slice(1)}`;

      buckets.push({
        key,
        shortLabel,
        fullLabel,
        revenue: 0,
        cogs: 0,
        expenses: 0,
        netProfit: 0,
        units: 0,
        salesCount: 0,
        marginPct: 0,
        momDeltaPct: null,
        prevLabel: null,
      });
    }

    const bucketMap = new Map(buckets.map((b) => [b.key, b]));

    for (const sale of sales) {
      if (sale.deliveryStatus === 'cancelled') continue;
      const d = sale.createdAt ? sale.createdAt.toDate() : new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      bucket.revenue += sale.totalAmount;
      bucket.cogs += sale.unitCost * sale.quantity;
      bucket.units += sale.quantity;
      bucket.salesCount += 1;
    }

    for (const exp of expenses) {
      const d = exp.createdAt ? exp.createdAt.toDate() : new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      bucket.expenses += exp.amount;
    }

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      b.netProfit = b.revenue - b.cogs - b.expenses;
      b.marginPct = b.revenue > 0 ? Math.round((b.netProfit / b.revenue) * 1000) / 10 : 0;

      if (i > 0) {
        const prev = buckets[i - 1];
        b.prevLabel = prev.shortLabel;
        if (Math.abs(prev.netProfit) >= 0.01) {
          b.momDeltaPct =
            Math.round(((b.netProfit - prev.netProfit) / Math.abs(prev.netProfit)) * 1000) / 10;
        }
      }
    }

    return buckets;
  }, [sales, expenses]);

  const stats = useMemo(() => {
    const hasActivity = monthsData.some((m) => m.salesCount > 0 || m.expenses > 0);
    const totalNet = monthsData.reduce((acc, m) => acc + m.netProfit, 0);
    const avgNet = totalNet / monthsData.length;

    let best = monthsData[monthsData.length - 1];
    for (const m of monthsData) {
      if (m.netProfit > best.netProfit) best = m;
    }

    const current = monthsData[monthsData.length - 1];

    return { hasActivity, totalNet, avgNet, best, current };
  }, [monthsData]);

  const activeMonth = useMemo(() => {
    if (selectedKey) {
      const found = monthsData.find((m) => m.key === selectedKey);
      if (found) return found;
    }
    return monthsData[monthsData.length - 1];
  }, [monthsData, selectedKey]);

  const scale = useMemo(() => {
    const profits = monthsData.map((m) => m.netProfit);
    const revenues = compareMode === 'revenue_vs_profit' ? monthsData.map((m) => m.revenue) : [0];
    const maxVal = Math.max(0, ...profits, ...revenues);
    const minVal = Math.min(0, ...profits);
    const range = maxVal - minVal > 0 ? maxVal - minVal : 100;
    const zeroBottomPct = (Math.abs(minVal) / range) * 100;
    const avgLineBottomPct = ((stats.avgNet - minVal) / range) * 100;
    return { maxVal, minVal, range, zeroBottomPct, avgLineBottomPct };
  }, [monthsData, compareMode, stats.avgNet]);

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Lucro Líquido dos Últimos 6 Meses
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Comparativo mensal para análise de sazonalidade · Receita bruta menos CMV e despesas operacionais
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start lg:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setCompareMode('profit')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              compareMode === 'profit'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Lucro Líquido
          </button>
          <button
            type="button"
            onClick={() => setCompareMode('revenue_vs_profit')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              compareMode === 'revenue_vs_profit'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Receita × Lucro
          </button>
        </div>
      </div>

      {!stats.hasActivity ? (
        <div className="py-12 text-center max-w-md mx-auto">
          <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="w-5 h-5" />
          </div>
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Sem histórico financeiro nos últimos 6 meses
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Registre vendas no PDV e lance despesas operacionais para visualizar a sazonalidade do lucro líquido mês a mês.
          </p>
          <button
            type="button"
            onClick={onAddExpense}
            className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Registrar Despesa</span>
          </button>
        </div>
      ) : (
        <>
          {/* 6-Month Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-2">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Lucro Acumulado (6m)</p>
              <p
                className={`font-mono tabular-nums text-lg font-semibold mt-0.5 ${
                  stats.totalNet >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {formatCurrency(stats.totalNet, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Média Mensal (6m)</p>
              <p className="font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {formatCurrency(stats.avgNet, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Melhor Mês do Período</p>
              <p className="font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {stats.best.shortLabel}{' '}
                <span className="text-xs font-normal text-emerald-700 dark:text-emerald-400">
                  ({formatCompactMoney(stats.best.netProfit, currency)})
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tendência ({stats.current.shortLabel})
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {stats.current.momDeltaPct === null ? (
                  <span className="font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-100">
                    —
                  </span>
                ) : (
                  <>
                    {stats.current.momDeltaPct >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <span
                      className={`font-mono tabular-nums text-lg font-semibold ${
                        stats.current.momDeltaPct >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {stats.current.momDeltaPct >= 0 ? '+' : ''}
                      {stats.current.momDeltaPct.toFixed(1).replace('.', ',')}%
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      vs. {stats.current.prevLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Chart Plot Area */}
          <div className="space-y-3">
            <div className={`relative h-64 pt-6 ${scale.minVal < 0 ? 'pb-6' : 'pb-2'}`}>
              {/* Subtle horizontal reference grid */}
              <div
                className={`absolute inset-x-0 top-6 pointer-events-none ${
                  scale.minVal < 0 ? 'bottom-6' : 'bottom-2'
                }`}
              >
                {/* Top max reference line */}
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200/80 dark:border-slate-700/70" />

                {/* 6-month average dashed line */}
                {stats.avgNet !== 0 &&
                  scale.avgLineBottomPct > 4 &&
                  scale.avgLineBottomPct < 96 && (
                    <div
                      style={{ bottom: `${scale.avgLineBottomPct}%` }}
                      className="absolute inset-x-0 border-t border-dashed border-orange-400/80 dark:border-orange-500/70"
                    />
                  )}

                {/* Zero baseline */}
                <div
                  style={{ bottom: `${scale.zeroBottomPct}%` }}
                  className="absolute inset-x-0 border-t border-slate-300 dark:border-slate-700"
                />
              </div>

              {/* 6 Month Columns */}
              <div className="relative z-10 grid grid-cols-6 gap-2 sm:gap-4 h-full">
                {monthsData.map((month, idx) => {
                  const isSelected = activeMonth.key === month.key;
                  const isCurrent = idx === monthsData.length - 1;
                  const isPositive = month.netProfit >= 0;

                  const profitBarPct =
                    Math.abs(month.netProfit) > 0
                      ? Math.max(3, (Math.abs(month.netProfit) / scale.range) * 100)
                      : 0;
                  const revenueBarPct =
                    month.revenue > 0
                      ? Math.max(3, (month.revenue / scale.range) * 100)
                      : 0;

                  return (
                    <button
                      key={month.key}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedKey(month.key)}
                      title={`${month.fullLabel}: Lucro Líquido ${formatCurrency(month.netProfit, currency)} · Receita ${formatCurrency(month.revenue, currency)}`}
                      className={`group relative flex flex-col items-center h-full rounded-lg px-1 pt-1 pb-0.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
                        isSelected
                          ? 'bg-slate-50/90 dark:bg-slate-800/50'
                          : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      {/* Plot Canvas inside column */}
                      <div className="relative w-full flex-1">
                        {compareMode === 'profit' ? (
                          <div className="relative w-full h-full flex justify-center">
                            {profitBarPct === 0 ? (
                              <div
                                style={{ bottom: `${scale.zeroBottomPct}%` }}
                                className="absolute w-full max-w-[44px] h-[3px] bg-slate-200 dark:bg-slate-700 rounded-xs"
                              />
                            ) : isPositive ? (
                              <div
                                style={{
                                  bottom: `${scale.zeroBottomPct}%`,
                                  height: `${profitBarPct}%`,
                                }}
                                className={`absolute w-full max-w-[44px] rounded-t-md transition-opacity ${
                                  isCurrent
                                    ? 'bg-emerald-700 dark:bg-emerald-500'
                                    : 'bg-emerald-600/90 dark:bg-emerald-500/80 group-hover:bg-emerald-600 dark:group-hover:bg-emerald-500'
                                } ${isSelected ? 'ring-2 ring-slate-900/20 dark:ring-white/25' : ''}`}
                              >
                                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] sm:text-[11px] font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {formatCompactMoney(month.netProfit, currency)}
                                </span>
                              </div>
                            ) : (
                              <div
                                style={{
                                  top: `${100 - scale.zeroBottomPct}%`,
                                  height: `${profitBarPct}%`,
                                }}
                                className={`absolute w-full max-w-[44px] rounded-b-md transition-opacity bg-red-600/90 dark:bg-red-500/90 group-hover:bg-red-600 dark:group-hover:bg-red-500 ${
                                  isSelected ? 'ring-2 ring-slate-900/20 dark:ring-white/25' : ''
                                }`}
                              >
                                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] sm:text-[11px] font-mono tabular-nums font-semibold text-red-700 dark:text-red-400 whitespace-nowrap">
                                  {formatCompactMoney(month.netProfit, currency)}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="relative w-full h-full flex items-end justify-center gap-1 sm:gap-1.5">
                            {/* Revenue Bar */}
                            <div className="relative w-1/2 max-w-[24px] h-full">
                              <div
                                style={{
                                  bottom: `${scale.zeroBottomPct}%`,
                                  height: `${revenueBarPct || 2}%`,
                                }}
                                className={`absolute inset-x-0 rounded-t-sm ${
                                  month.revenue > 0
                                    ? 'bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-400 dark:group-hover:bg-slate-500'
                                    : 'bg-slate-100 dark:bg-slate-800'
                                }`}
                              />
                            </div>
                            {/* Net Profit Bar */}
                            <div className="relative w-1/2 max-w-[24px] h-full">
                              {profitBarPct === 0 ? (
                                <div
                                  style={{ bottom: `${scale.zeroBottomPct}%` }}
                                  className="absolute inset-x-0 h-[3px] bg-slate-200 dark:bg-slate-700 rounded-xs"
                                />
                              ) : isPositive ? (
                                <div
                                  style={{
                                    bottom: `${scale.zeroBottomPct}%`,
                                    height: `${profitBarPct}%`,
                                  }}
                                  className="absolute inset-x-0 rounded-t-sm bg-emerald-600 dark:bg-emerald-500"
                                >
                                  <span className="hidden sm:block absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                    {formatCompactMoney(month.netProfit, currency)}
                                  </span>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    top: `${100 - scale.zeroBottomPct}%`,
                                    height: `${profitBarPct}%`,
                                  }}
                                  className="absolute inset-x-0 rounded-b-sm bg-red-600 dark:bg-red-500"
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* X-Axis Labels */}
            <div className="grid grid-cols-6 gap-2 sm:gap-4 pt-1">
              {monthsData.map((month, idx) => {
                const isSelected = activeMonth.key === month.key;
                const isCurrent = idx === monthsData.length - 1;
                return (
                  <button
                    key={month.key}
                    type="button"
                    onClick={() => setSelectedKey(month.key)}
                    className="flex flex-col items-center gap-1 cursor-pointer focus-visible:outline-none"
                  >
                    <span
                      className={`text-xs font-mono tabular-nums whitespace-nowrap ${
                        isSelected
                          ? 'font-bold text-slate-900 dark:text-slate-100'
                          : isCurrent
                            ? 'font-semibold text-orange-700 dark:text-orange-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {month.shortLabel}
                    </span>
                    <span
                      className={`h-0.5 w-6 rounded-full transition-colors ${
                        isSelected ? 'bg-orange-600' : 'bg-transparent'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            {/* Chart Legend */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex flex-wrap items-center gap-4">
                {compareMode === 'revenue_vs_profit' && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 dark:bg-slate-600 inline-block" />
                    <span>Receita Bruta</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500 inline-block" />
                  <span>Lucro Líquido</span>
                </span>
                {scale.minVal < 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-600 dark:bg-red-500 inline-block" />
                    <span>Prejuízo</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-4 border-t border-dashed border-orange-500 inline-block" />
                  <span>Média 6 meses</span>
                </span>
              </div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Clique em qualquer mês para detalhar
              </span>
            </div>
          </div>

          {/* Selected Month Detail Breakdown */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {activeMonth.fullLabel}
                <span className="text-slate-400 dark:text-slate-600 font-normal"> · </span>
                <span className="font-mono tabular-nums text-xs font-normal text-slate-600 dark:text-slate-400">
                  {activeMonth.salesCount} vendas ({activeMonth.units} botijões)
                </span>
              </div>
              {activeMonth.momDeltaPct !== null && (
                <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  Variação vs. {activeMonth.prevLabel}:{' '}
                  <span
                    className={`font-semibold ${
                      activeMonth.momDeltaPct >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {activeMonth.momDeltaPct >= 0 ? '+' : ''}
                    {activeMonth.momDeltaPct.toFixed(1).replace('.', ',')}%
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
              <div>
                <p className="text-slate-500 dark:text-slate-400">Receita Bruta</p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatCurrency(activeMonth.revenue, currency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Custo Mercadorias (CMV)</p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-700 dark:text-slate-300 mt-0.5">
                  - {formatCurrency(activeMonth.cogs, currency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Despesas Operacionais</p>
                <p className="font-mono tabular-nums text-sm font-semibold text-red-700 dark:text-red-400 mt-0.5">
                  - {formatCurrency(activeMonth.expenses, currency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Lucro Líquido</p>
                <p
                  className={`font-mono tabular-nums text-sm font-semibold mt-0.5 ${
                    activeMonth.netProfit >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {formatCurrency(activeMonth.netProfit, currency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Margem Líquida</p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {activeMonth.marginPct.toFixed(1).replace('.', ',')}%
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
