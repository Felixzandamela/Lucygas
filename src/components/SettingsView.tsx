import {
  AlertTriangle,
  BellOff,
  BellRing,
  CheckCircle2,
  History,
  Monitor,
  Moon,
  Plus,
  Send,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { type ThemeMode, useTheme } from '../contexts/ThemeContext';
import type { PushNotificationPrefs, PushPermissionState } from '../hooks/usePushNotifications';
import { getRecordMillis } from '../lib/formatters';
import {
  discardRecordsBatch,
  updateCylindersMinStock,
  updateDepotSettings,
} from '../services/depotService';
import {
  type CurrencyCode,
  type Cylinder,
  type Depot,
  type Expense,
  FIELD_LIMITS,
  type Sale,
  type StockMovement,
} from '../types/gas';
import { getHistoricalDraftKey, HistoricalLedgerModal } from './HistoricalLedgerModal';

interface SettingsViewProps {
  uid: string;
  depot: Depot | null;
  cylinders: Cylinder[];
  sales: Sale[];
  movements: StockMovement[];
  expenses: Expense[];
  pushControls?: {
    permission: PushPermissionState;
    prefs: PushNotificationPrefs;
    isPushActive: boolean;
    feedbackMsg: string | null;
    onEnablePush: () => Promise<boolean>;
    onDisablePush: () => void;
    onUpdatePrefs: (partial: Partial<PushNotificationPrefs>) => void;
    onSendTest: () => Promise<void>;
  };
}

const THEME_OPTIONS: {
  id: ThemeMode;
  label: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  {
    id: 'light',
    label: 'Claro',
    hint: 'Fundo claro de alto contraste para uso diurno',
    icon: Sun,
  },
  {
    id: 'dark',
    label: 'Escuro',
    hint: 'Reduz o brilho em ambientes com pouca luz',
    icon: Moon,
  },
  {
    id: 'system',
    label: 'Sistema',
    hint: 'Acompanha a preferência do dispositivo',
    icon: Monitor,
  },
];

export function SettingsView({
  uid,
  depot,
  cylinders,
  sales,
  movements,
  expenses,
  pushControls,
}: SettingsViewProps) {
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('BRL');
  const [deliveryFee, setDeliveryFee] = useState<number>(8);
  const [drivers, setDrivers] = useState<string[]>([]);
  const [newDriver, setNewDriver] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [minStocks, setMinStocks] = useState<Record<string, number>>({});
  const [savingMinStock, setSavingMinStock] = useState(false);
  const [savedMinStockNotice, setSavedMinStockNotice] = useState(false);

  const [showHistoricalModal, setShowHistoricalModal] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(`lucygas_historical_modal_open_${uid}`) === '1';
  });
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.localStorage.getItem(getHistoricalDraftKey(uid)));
  });
  const [confirmDiscardRecent, setConfirmDiscardRecent] = useState(false);
  const [discardingRecent, setDiscardingRecent] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  const openHistoricalModal = () => {
    setShowHistoricalModal(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`lucygas_historical_modal_open_${uid}`, '1');
    }
  };

  const closeHistoricalModal = () => {
    setShowHistoricalModal(false);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(`lucygas_historical_modal_open_${uid}`);
      setHasSavedDraft(Boolean(window.localStorage.getItem(getHistoricalDraftKey(uid))));
    }
  };

  const todayRecords = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();

    const todaySales = sales.filter((s) => getRecordMillis(s) >= startOfToday);
    const todayMovements = movements.filter((m) => getRecordMillis(m) >= startOfToday);
    const todayExpenses = expenses.filter((e) => getRecordMillis(e) >= startOfToday);

    return {
      sales: todaySales,
      movements: todayMovements,
      expenses: todayExpenses,
      totalCount: todaySales.length + todayMovements.length + todayExpenses.length,
    };
  }, [sales, movements, expenses]);

  useEffect(() => {
    if (depot) {
      setName(depot.name);
      setCurrency(depot.currency);
      setDeliveryFee(depot.deliveryFee);
      setDrivers(depot.drivers || []);
    }
  }, [depot]);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const cyl of cylinders) {
      next[cyl.id] = cyl.minStock;
    }
    setMinStocks(next);
  }, [cylinders]);

  const handleAddDriver = () => {
    const clean = newDriver.trim().slice(0, FIELD_LIMITS.DRIVER_NAME);
    if (!clean || drivers.length >= FIELD_LIMITS.MAX_DRIVERS) return;
    if (!drivers.includes(clean)) {
      setDrivers((prev) => [...prev, clean]);
    }
    setNewDriver('');
  };

  const handleRemoveDriver = (drv: string) => {
    setDrivers((prev) => prev.filter((item) => item !== drv));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setSavedNotice(false);
    try {
      await updateDepotSettings(uid, { name, currency, deliveryFee, drivers });
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  const handleMinStockSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const updates = cylinders
      .map((cyl) => ({
        cylinderId: cyl.id,
        minStock: Math.max(0, Math.floor(minStocks[cyl.id] ?? cyl.minStock)),
      }))
      .filter((item, idx) => item.minStock !== cylinders[idx].minStock);

    setSavingMinStock(true);
    setSavedMinStockNotice(false);
    try {
      if (updates.length > 0) {
        await updateCylindersMinStock(uid, updates);
      }
      setSavedMinStockNotice(true);
    } finally {
      setSavingMinStock(false);
    }
  };

  const handleDiscardSavedDraft = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(getHistoricalDraftKey(uid));
    }
    setHasSavedDraft(false);
    setDataNotice('Rascunho de reconstrução de histórico descartado.');
  };

  const handleDiscardTodayOnly = async () => {
    setDiscardingRecent(true);
    setDataNotice(null);
    try {
      await discardRecordsBatch(
        uid,
        todayRecords.sales,
        todayRecords.movements,
        todayRecords.expenses
      );
      setDataNotice(
        `Registros de hoje descartados (${todayRecords.sales.length} vendas, ${todayRecords.movements.length} movimentações, ${todayRecords.expenses.length} despesas).`
      );
      setConfirmDiscardRecent(false);
    } finally {
      setDiscardingRecent(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      {/* Historical Correction & Ledger Reconstruction */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Correcção de histórico
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Descarte registros de hoje ou reconstrua o histórico de vendas e estoque por intervalo de datas
            </p>
          </div>
          <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            Hoje: {todayRecords.sales.length} vendas · {todayRecords.movements.length} mov.
          </span>
        </div>

        {dataNotice && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>{dataNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={openHistoricalModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 cursor-pointer whitespace-nowrap"
          >
            <History className="w-4 h-4" />
            <span>
              Reconstruir Histórico
              {hasSavedDraft ? ' · Rascunho salvo' : ''}
            </span>
          </button>

          {hasSavedDraft && (
            <button
              type="button"
              onClick={handleDiscardSavedDraft}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-amber-300 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/35 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Descartar Rascunho</span>
            </button>
          )}

          <button
            type="button"
            disabled={todayRecords.totalCount === 0}
            onClick={() => setConfirmDiscardRecent(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-100/80 dark:hover:bg-red-950/60 disabled:opacity-45 cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-4 h-4" />
            <span>Descartar hoje ({todayRecords.totalCount})</span>
          </button>
        </div>
      </section>

      {/* Appearance & Theme Selector */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Aparência e Tema
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Alterne entre o modo claro e escuro para melhorar a leitura em ambientes de baixa luminosidade
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Selecionar tema">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(opt.id)}
                className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'border-orange-600 bg-orange-50/70 dark:bg-orange-950/35 ring-1 ring-orange-600'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                    <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {opt.label}
                    </span>
                  </div>
                  {active && (
                    <CheckCircle2 className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {opt.hint}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {savedNotice && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-4 flex items-center gap-3 text-sm text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>Configurações da distribuidora atualizadas com sucesso.</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6"
      >
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Dados da Distribuidora e Operação
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Personalize o nome exibido, moeda, taxa padrão de entrega e entregadores
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Nome da Distribuidora
            </label>
            <input
              type="text"
              required
              maxLength={FIELD_LIMITS.DEPOT_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Moeda Padrão
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
            >
              <option value="BRL">Real Brasileiro (R$)</option>
              <option value="MZN">Metical Moçambicano (MT)</option>
              <option value="EUR">Euro (€)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Taxa Padrão de Entrega
            </label>
            <input
              type="number"
              min={0}
              step="0.50"
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Equipe de Entregadores ({drivers.length}/{FIELD_LIMITS.MAX_DRIVERS})
          </label>
          <div className="flex gap-2 min-w-0">
            <input
              type="text"
              maxLength={FIELD_LIMITS.DRIVER_NAME}
              value={newDriver}
              onChange={(e) => setNewDriver(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDriver();
                }
              }}
              placeholder="Nome do entregador..."
              className="flex-1 min-w-0 w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
            />
            <button
              type="button"
              onClick={handleAddDriver}
              className="shrink-0 px-3.5 sm:px-4 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Adicionar</span>
            </button>
          </div>

          {drivers.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              {drivers.map((drv) => (
                <div
                  key={drv}
                  className="flex items-center justify-between px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950/60"
                >
                  <span>{drv}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveDriver(drv)}
                    title={`Remover ${drv}`}
                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-sm font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </form>

      {/* Minimum Stock Thresholds per Cylinder Type */}
      {savedMinStockNotice && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-4 flex items-center gap-3 text-sm text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>Limites de estoque mínimo por botijão salvos com sucesso.</span>
        </div>
      )}

      <form
        onSubmit={handleMinStockSubmit}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
      >
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Estoque Mínimo por Tipo de Botijão
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Defina a quantidade mínima de botijões cheios para acionar o alerta visual na tela de inventário
          </p>
        </div>

        {cylinders.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
            Nenhum tipo de botijão cadastrado no estoque ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-4">Botijão</th>
                  <th className="py-2.5 px-4 text-right">Saldo Cheios Atual</th>
                  <th className="py-2.5 px-4 text-right">Estoque Mínimo</th>
                  <th className="py-2.5 pl-4 text-right">Prévia do Alerta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {cylinders.map((cyl) => {
                  const configuredMin = minStocks[cyl.id] ?? cyl.minStock;
                  const isBelow = cyl.fullCount < configuredMin;
                  return (
                    <tr key={cyl.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-3 pr-4">
                        <div className="font-display font-semibold text-slate-900 dark:text-slate-100">
                          {cyl.code}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{cyl.name}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                        {cyl.fullCount} un
                      </td>
                      <td className="py-3 px-4 text-right">
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          aria-label={`Estoque mínimo de ${cyl.code}`}
                          value={configuredMin}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(10000, Number(e.target.value) || 0));
                            setMinStocks((prev) => ({ ...prev, [cyl.id]: val }));
                          }}
                          className="w-24 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-right font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                        />
                      </td>
                      <td className="py-3 pl-4 text-right">
                        {cyl.fullCount === 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Esgotado</span>
                          </span>
                        ) : isBelow ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Alerta Ativo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Saldo Normal</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={savingMinStock || cylinders.length === 0}
            className="px-5 py-2.5 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
          >
            {savingMinStock ? 'Salvando limites...' : 'Salvar Limites de Estoque'}
          </button>
        </div>
      </form>

      {/* PWA Push Notifications Settings */}
      {pushControls && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Notificações Push (PWA)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Receba alertas do sistema neste dispositivo quando houver estoque baixo ou novas entregas pendentes
              </p>
            </div>

            <div className="flex items-center gap-2">
              {pushControls.isPushActive ? (
                <>
                  <button
                    type="button"
                    onClick={() => void pushControls.onSendTest()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Testar Notificação</span>
                  </button>
                  <button
                    type="button"
                    onClick={pushControls.onDisablePush}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    <span>Pausar Alertas</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void pushControls.onEnablePush()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 cursor-pointer whitespace-nowrap"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Ativar Notificações Push</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 cursor-pointer">
              <input
                type="checkbox"
                checked={pushControls.prefs.lowStockAlerts}
                onChange={(e) =>
                  pushControls.onUpdatePrefs({ lowStockAlerts: e.target.checked })
                }
                className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600"
              />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Alertas de Estoque Mínimo
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Notificar quando o saldo de botijões cheios ficar abaixo do mínimo ou zerar
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 cursor-pointer">
              <input
                type="checkbox"
                checked={pushControls.prefs.pendingDeliveryAlerts}
                onChange={(e) =>
                  pushControls.onUpdatePrefs({ pendingDeliveryAlerts: e.target.checked })
                }
                className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600"
              />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Novas Entregas Pendentes
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Notificar assim que uma nova entrega aguardando despacho entrar na fila
                </p>
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
            <span>
              Status do navegador:{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {pushControls.permission === 'granted'
                  ? pushControls.prefs.enabled
                    ? 'Ativo neste dispositivo'
                    : 'Permitido (pausado)'
                  : pushControls.permission === 'denied'
                    ? 'Bloqueado nas configurações do navegador'
                    : pushControls.permission === 'unsupported'
                      ? 'Não suportado neste navegador'
                      : 'Aguardando autorização'}
              </strong>
            </span>
          </div>

          {pushControls.feedbackMsg && (
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300">
              {pushControls.feedbackMsg}
            </div>
          )}
        </section>
      )}
      {showHistoricalModal && (
        <HistoricalLedgerModal
          uid={uid}
          currency={depot?.currency ?? 'MZN'}
          cylinders={cylinders}
          sales={sales}
          movements={movements}
          expenses={expenses}
          todayCounts={{
            sales: todayRecords.sales.length,
            movements: todayRecords.movements.length,
            expenses: todayRecords.expenses.length,
          }}
          todayItems={{
            sales: todayRecords.sales,
            movements: todayRecords.movements,
            expenses: todayRecords.expenses,
          }}
          onClose={closeHistoricalModal}
          onSuccess={(msg) => setDataNotice(msg)}
        />
      )}

      {confirmDiscardRecent && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Descartar dados de hoje?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Serão removidos {todayRecords.sales.length} venda(s), {todayRecords.movements.length} movimentação(ões) e {todayRecords.expenses.length} despesa(s) registradas hoje. O estoque atual dos botijões não será alterado automaticamente (use &ldquo;Reconstruir Histórico&rdquo; se quiser recalcular o estoque junto).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDiscardRecent(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={discardingRecent}
                onClick={handleDiscardTodayOnly}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {discardingRecent ? 'Descartando...' : 'Confirmar Descarte'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
