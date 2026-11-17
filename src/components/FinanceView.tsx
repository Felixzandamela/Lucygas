import { Download, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { formatCurrency, formatDateTime, getRecordMillis, getRecordTimestamp } from '../lib/formatters';
import { createExpense, removeExpense } from '../services/depotService';
import {
  type CurrencyCode,
  type Expense,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  FIELD_LIMITS,
  type MemberPermissions,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type Sale,
  SELECTABLE_PAYMENT_METHODS,
} from '../types/gas';
import { MonthlyProfitChart } from './MonthlyProfitChart';

interface FinanceViewProps {
  uid: string;
  currency: CurrencyCode;
  sales: Sale[];
  expenses: Expense[];
  permissions: MemberPermissions;
}

type PeriodFilter = 'today' | '7d' | '30d' | 'all';

export function FinanceView({ uid, currency, sales, expenses, permissions }: FinanceViewProps) {
  const [period, setPeriod] = useState<PeriodFilter>('30d');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('fuel');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const periodThreshold = useMemo(() => {
    const now = new Date();
    if (period === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    if (period === '7d') return Date.now() - 7 * 86400000;
    if (period === '30d') return Date.now() - 30 * 86400000;
    return 0;
  }, [period]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (s.deliveryStatus === 'cancelled') return false;
      const ms = getRecordMillis(s);
      return ms >= periodThreshold;
    });
  }, [sales, periodThreshold]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const ms = getRecordMillis(e);
      return ms >= periodThreshold;
    });
  }, [expenses, periodThreshold]);

  const summary = useMemo(() => {
    const revenue = filteredSales.reduce((acc, s) => acc + s.totalAmount, 0);
    const cogs = filteredSales.reduce((acc, s) => acc + s.unitCost * s.quantity, 0);
    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
    const netProfit = revenue - cogs - totalExpenses;
    const pendingReceivables = filteredSales
      .filter((s) => s.paymentStatus === 'pending')
      .reduce((acc, s) => acc + s.totalAmount, 0);

    const byPayment: Record<PaymentMethod, number> = {
      mpesa: 0,
      emola: 0,
      cash: 0,
      card: 0,
      credit: 0,
      pix: 0,
    };
    for (const s of filteredSales) {
      byPayment[s.paymentMethod] = (byPayment[s.paymentMethod] ?? 0) + s.totalAmount;
    }

    return {
      revenue,
      cogs,
      totalExpenses,
      netProfit,
      pendingReceivables,
      byPayment,
    };
  }, [filteredSales, filteredExpenses]);

  const handleAddExpense = async (e: FormEvent) => {
    e.preventDefault();
    const num = Number(amount);
    if (!description.trim() || !Number.isFinite(num) || num <= 0) return;
    setSaving(true);
    try {
      await createExpense(uid, { category, description, amount: num });
      setDescription('');
      setAmount('');
      setShowExpenseModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const header = ['Pedido', 'Data', 'Cliente', 'Botijao', 'Qtd', 'Modalidade', 'Pagamento', 'StatusPagamento', 'StatusEntrega', 'Total'];
    const rows = filteredSales.map((s) => [
      s.orderNumber,
      formatDateTime(getRecordTimestamp(s)),
      `"${s.customerName.replace(/"/g, '""')}"`,
      s.cylinderCode,
      String(s.quantity),
      s.saleMode === 'exchange' ? 'Troca' : 'Casco Novo',
      PAYMENT_METHOD_LABELS[s.paymentMethod],
      s.paymentStatus === 'paid' ? 'Pago' : 'Em Aberto',
      s.deliveryStatus,
      s.totalAmount.toFixed(2),
    ]);
    const csv = [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lucygas-vendas-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const periods: { id: PeriodFilter; label: string }[] = [
    { id: 'today', label: 'Hoje' },
    { id: '7d', label: '7 Dias' },
    { id: '30d', label: '30 Dias' },
    { id: 'all', label: 'Tudo' },
  ];

  return (
    <div className="space-y-8">
      {/* Period & Actions */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {periods.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                period === p.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredSales.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
          {permissions.manageExpenses && (
            <button
              type="button"
              onClick={() => setShowExpenseModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Registrar Despesa</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Receita Bruta</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
            {formatCurrency(summary.revenue, currency)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-mono tabular-nums">
            {filteredSales.length} vendas no período
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Custo das Mercadorias (CMV)
          </p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
            {formatCurrency(summary.cogs, currency)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Baseado no custo unitário dos botijões
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Despesas Operacionais
          </p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
            {formatCurrency(summary.totalExpenses, currency)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-mono tabular-nums">
            {filteredExpenses.length} lançamentos
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Resultado Líquido Estimado
          </p>
          <p
            className={`font-mono tabular-nums text-2xl font-semibold mt-1.5 ${
              summary.netProfit >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-700 dark:text-red-400'
            }`}
          >
            {formatCurrency(summary.netProfit, currency)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-mono tabular-nums">
            A receber: {formatCurrency(summary.pendingReceivables, currency)}
          </p>
        </div>
      </section>

      {/* 6-Month Seasonality & Net Profit Chart */}
      <MonthlyProfitChart
        currency={currency}
        sales={sales}
        expenses={expenses}
        onAddExpense={() => setShowExpenseModal(true)}
      />

      {/* Split: Payment Methods + Expenses */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Recebimentos por Meio
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Distribuição do faturamento no período selecionado
            </p>
          </div>

          <div className="space-y-4">
            {(
              summary.byPayment.pix > 0
                ? ([...SELECTABLE_PAYMENT_METHODS, 'pix'] as PaymentMethod[])
                : (SELECTABLE_PAYMENT_METHODS as PaymentMethod[])
            ).map((method) => {
              const val = summary.byPayment[method];
              const pct = summary.revenue > 0 ? Math.round((val / summary.revenue) * 100) : 0;
              return (
                <div key={method} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {PAYMENT_METHOD_LABELS[method]}
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                      {formatCurrency(val, currency)}{' '}
                      <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                        ({pct}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full ${
                        method === 'credit' ? 'bg-amber-500' : 'bg-slate-900 dark:bg-orange-500'
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Despesas Lançadas
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Combustível, manutenção de frota, entregas e custos fixos
              </p>
            </div>
          </div>

          {filteredExpenses.length === 0 ? (
            <div className="py-12 text-center px-6">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Nenhuma despesa registrada neste período
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Lance custos operacionais para acompanhar o lucro real da distribuidora.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Data</th>
                    <th className="py-2.5 px-4">Categoria</th>
                    <th className="py-2.5 px-4">Descrição</th>
                    <th className="py-2.5 px-4 text-right">Valor</th>
                    <th className="py-2.5 px-4 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {filteredExpenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDateTime(getRecordTimestamp(exp))}
                      </td>
                      <td className="py-2.5 px-4 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {EXPENSE_CATEGORY_LABELS[exp.category]}
                      </td>
                      <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100">
                        {exp.description}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-red-700 dark:text-red-400">
                        - {formatCurrency(exp.amount, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {permissions.manageExpenses && (
                          <button
                            type="button"
                            onClick={() => removeExpense(uid, exp.id)}
                            title="Excluir despesa"
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Add Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Registrar Despesa
              </h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddExpense} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Categoria
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                >
                  {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {EXPENSE_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Descrição *
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.EXPENSE_DESC}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Abastecimento moto de entrega"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Valor ({currency}) *
                </label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Salvar Despesa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
