import {
  Calendar,
  CheckCircle2,
  Database,
  GripVertical,
  History,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, getRecordDate, getRecordMillis } from '../lib/formatters';
import {
  applyHistoricalLedgerRebuild,
  deleteSingleHistoricalEvent,
  type HistoricalEventKind,
  type HistoricalInitialStockInput,
  type HistoricalLedgerEventInput,
  saveInitialStockToFirestore,
  saveSingleHistoricalEvent,
} from '../services/depotService';
import type { CurrencyCode, Cylinder, Expense, Sale, StockMovement } from '../types/gas';

interface HistoricalLedgerModalProps {
  uid: string;
  currency: CurrencyCode;
  cylinders: Cylinder[];
  sales: Sale[];
  movements: StockMovement[];
  expenses: Expense[];
  todayCounts: {
    sales: number;
    movements: number;
    expenses: number;
  };
  todayItems: {
    sales: Sale[];
    movements: StockMovement[];
    expenses: Expense[];
  };
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

type DiscardScope = 'selected_period' | 'today_only' | 'all_ledger';
type DropPosition = 'before' | 'after';

const KIND_LABELS: Record<HistoricalEventKind, string> = {
  sale: 'Venda (Troca)',
  restock: 'Reposição',
  acquisition: 'Aquisição Completa',
};

function toIsoDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDefaultDateRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: toIsoDateStr(firstOfMonth),
    endDate: toIsoDateStr(now),
  };
}

function formatBrDate(iso: string): string {
  if (!iso || !iso.includes('-')) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function buildInitialStocksFromCylinders(cylinders: Cylinder[]): HistoricalInitialStockInput[] {
  if (cylinders.length > 0) {
    return cylinders.map((c) => ({
      code: c.code.trim().toUpperCase(),
      fullCount: c.fullCount,
      emptyCount: c.emptyCount,
    }));
  }
  return [
    { code: 'G11', fullCount: 0, emptyCount: 0 },
    { code: 'P9', fullCount: 0, emptyCount: 0 },
    { code: 'M12', fullCount: 0, emptyCount: 0 },
  ];
}

function reorderEventsList(
  list: HistoricalLedgerEventInput[],
  draggedId: string,
  targetId: string,
  position: DropPosition
): HistoricalLedgerEventInput[] {
  if (draggedId === targetId) return list;
  const fromIdx = list.findIndex((item) => item.id === draggedId);
  if (fromIdx === -1) return list;

  const updated = [...list];
  const [moved] = updated.splice(fromIdx, 1);
  const targetIdx = updated.findIndex((item) => item.id === targetId);
  if (targetIdx === -1) {
    updated.splice(fromIdx, 0, moved);
    return list;
  }

  const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
  updated.splice(insertIdx, 0, moved);
  return updated;
}

export function getHistoricalDraftKey(uid: string): string {
  return `lucygas_historical_draft_v2_${uid}`;
}

interface HistoricalDraftPayload {
  startDate: string;
  endDate: string;
  initialStocks: HistoricalInitialStockInput[];
  events: HistoricalLedgerEventInput[];
  discardScope: DiscardScope;
  initialSaved?: boolean;
  savedAt: number;
}

function loadDraftFromStorage(uid: string): HistoricalDraftPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getHistoricalDraftKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HistoricalDraftPayload>;
    if (!Array.isArray(parsed.initialStocks) || !Array.isArray(parsed.events)) return null;
    const defaults = getDefaultDateRange();
    const validScope: DiscardScope =
      parsed.discardScope === 'all_ledger' ||
      parsed.discardScope === 'today_only' ||
      parsed.discardScope === 'selected_period'
        ? parsed.discardScope
        : 'selected_period';
    return {
      startDate: typeof parsed.startDate === 'string' && parsed.startDate ? parsed.startDate : defaults.startDate,
      endDate: typeof parsed.endDate === 'string' && parsed.endDate ? parsed.endDate : defaults.endDate,
      initialStocks: parsed.initialStocks,
      events: parsed.events,
      discardScope: validScope,
      initialSaved: Boolean(parsed.initialSaved),
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function HistoricalLedgerModal({
  uid,
  currency,
  cylinders,
  sales,
  movements,
  todayCounts,
  todayItems,
  onClose,
  onSuccess,
}: HistoricalLedgerModalProps) {
  const [initialDraft] = useState<HistoricalDraftPayload | null>(() => loadDraftFromStorage(uid));
  const defaultRange = useMemo(() => getDefaultDateRange(), []);

  const [startDate, setStartDate] = useState<string>(
    () => initialDraft?.startDate ?? defaultRange.startDate
  );
  const [endDate, setEndDate] = useState<string>(
    () => initialDraft?.endDate ?? defaultRange.endDate
  );
  const [initialStocks, setInitialStocks] = useState<HistoricalInitialStockInput[]>(() =>
    initialDraft
      ? initialDraft.initialStocks.map((s) => ({ ...s }))
      : buildInitialStocksFromCylinders(cylinders)
  );
  const [events, setEvents] = useState<HistoricalLedgerEventInput[]>(() =>
    initialDraft ? initialDraft.events.map((e) => ({ ...e })) : []
  );
  const [discardScope, setDiscardScope] = useState<DiscardScope>(
    () => initialDraft?.discardScope ?? 'selected_period'
  );
  const [initialSaved, setInitialSaved] = useState<boolean>(() => Boolean(initialDraft?.initialSaved));
  const [savingInitial, setSavingInitial] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);

  // Drag-and-drop state (Desktop HTML5 + Mobile Touch)
  const [armedDragId, setArmedDragId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [touchDragId, setTouchDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  const touchDragIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<{ id: string; position: DropPosition } | null>(null);
  touchDragIdRef.current = touchDragId;
  dropTargetRef.current = dropTarget;

  const moveEventRow = useCallback(
    (sourceId: string, targetId: string, position: DropPosition) => {
      setEvents((prev) => reorderEventsList(prev, sourceId, targetId, position));
    },
    []
  );

  // Touch drag listeners (non-passive touchmove to avoid page scroll while dragging handle)
  useEffect(() => {
    if (!touchDragId) return;

    const handleTouchMove = (e: TouchEvent) => {
      const currentDragId = touchDragIdRef.current;
      if (!currentDragId || e.touches.length === 0) return;
      e.preventDefault();

      const touch = e.touches[0];
      const hit = document
        .elementFromPoint(touch.clientX, touch.clientY)
        ?.closest('tr[data-ledger-row-id]') as HTMLElement | null;

      if (!hit) return;
      const targetId = hit.getAttribute('data-ledger-row-id');
      if (!targetId || targetId === currentDragId) return;

      const rect = hit.getBoundingClientRect();
      const position: DropPosition = touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setDropTarget({ id: targetId, position });
    };

    const handleTouchEnd = () => {
      const currentDragId = touchDragIdRef.current;
      const currentDrop = dropTargetRef.current;
      if (currentDragId && currentDrop && currentDrop.id !== currentDragId) {
        moveEventRow(currentDragId, currentDrop.id, currentDrop.position);
      }
      setTouchDragId(null);
      setDraggedId(null);
      setArmedDragId(null);
      setDropTarget(null);
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [touchDragId, moveEventRow]);

  // Auto-save draft to localStorage whenever there are edits to preserve
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = getHistoricalDraftKey(uid);
      if (events.length === 0 && !initialSaved) {
        window.localStorage.removeItem(key);
        return;
      }
      const payload: HistoricalDraftPayload = {
        startDate,
        endDate,
        initialStocks,
        events,
        discardScope,
        initialSaved,
        savedAt: Date.now(),
      };
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignore storage quota issues
    }
  }, [uid, startDate, endDate, initialStocks, events, discardScope, initialSaved]);

  const periodItems = useMemo(() => {
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const rawEndMs = new Date(`${endDate}T23:59:59.999`).getTime();
    const endMs = Math.max(startMs, rawEndMs);

    const periodSales = sales.filter((s) => {
      const ms = getRecordMillis(s);
      return ms >= startMs && ms <= endMs;
    });
    const periodMovements = movements.filter((m) => {
      const ms = getRecordMillis(m);
      return ms >= startMs && ms <= endMs;
    });

    return {
      sales: periodSales,
      movements: periodMovements,
    };
  }, [sales, movements, startDate, endDate]);

  const cylinderByCode = useMemo(() => {
    const map = new Map<string, Cylinder>();
    for (const c of cylinders) {
      map.set(c.code.trim().toUpperCase(), c);
    }
    return map;
  }, [cylinders]);

  const simulation = useMemo(() => {
    const state: Record<string, { full: number; empty: number }> = {};
    for (const init of initialStocks) {
      state[init.code] = {
        full: Math.max(0, Math.floor(init.fullCount)),
        empty: Math.max(0, Math.floor(init.emptyCount)),
      };
    }

    const rowBalances: Record<string, { full: number; empty: number; negativeWarning: boolean }> = {};
    let totalSalesRevenue = 0;
    let totalSalesCount = 0;
    let totalUnitsSold = 0;
    let hasNegativeWarning = false;

    for (const ev of events) {
      const code = ev.cylinderCode.trim().toUpperCase();
      if (!state[code]) {
        state[code] = { full: 0, empty: 0 };
      }
      const cur = state[code];
      const qty = Math.max(1, Math.floor(ev.quantity));
      let negativeWarning = false;

      if (ev.kind === 'sale') {
        if (cur.full < qty) {
          negativeWarning = true;
          hasNegativeWarning = true;
        }
        cur.full = Math.max(0, cur.full - qty);
        cur.empty += qty;

        const cyl = cylinderByCode.get(code);
        const unitPrice = cyl?.salePrice ?? 0;
        totalSalesRevenue += Math.max(0, unitPrice * qty - (ev.discount || 0));
        totalSalesCount += 1;
        totalUnitsSold += qty;
      } else if (ev.kind === 'restock') {
        const emptiesUsed = Math.min(cur.empty, qty);
        cur.full += qty;
        cur.empty -= emptiesUsed;
      } else if (ev.kind === 'acquisition') {
        cur.full += qty;
      }

      rowBalances[ev.id] = {
        full: cur.full,
        empty: cur.empty,
        negativeWarning,
      };
    }

    return {
      finalState: state,
      rowBalances,
      totalSalesRevenue,
      totalSalesCount,
      totalUnitsSold,
      hasNegativeWarning,
    };
  }, [initialStocks, events, cylinderByCode]);

  const handleStartDateChange = (nextStart: string) => {
    if (!nextStart) return;
    setStartDate(nextStart);
    setInitialSaved(false);
    if (nextStart > endDate) {
      setEndDate(nextStart);
    }
  };

  const handleEndDateChange = (nextEnd: string) => {
    if (!nextEnd) return;
    setEndDate(nextEnd);
    if (nextEnd < startDate) {
      setStartDate(nextEnd);
      setInitialSaved(false);
    }
  };

  const handleLoadPeriodFromDb = () => {
    setErrorMsg(null);
    setRowNotice(null);

    const combined: { ts: number; event: HistoricalLedgerEventInput }[] = [];

    for (const s of periodItems.sales) {
      const dt = getRecordDate(s);
      combined.push({
        ts: getRecordMillis(s),
        event: {
          id: `db_sale_${s.id}`,
          dateStr: toIsoDateStr(dt),
          kind: 'sale',
          cylinderCode: s.cylinderCode.trim().toUpperCase(),
          quantity: Math.max(1, Math.floor(s.quantity)),
          discount: Math.max(0, s.discount || 0),
          note: s.notes || '',
        },
      });
    }

    for (const m of periodItems.movements) {
      if (m.movementType !== 'restock') continue;
      const dt = getRecordDate(m);
      const isAcquisition = m.emptyDelta === 0 && m.fullDelta > 0 && m.note.toLowerCase().includes('aquisi');
      combined.push({
        ts: getRecordMillis(m),
        event: {
          id: `db_mov_${m.id}`,
          dateStr: toIsoDateStr(dt),
          kind: isAcquisition ? 'acquisition' : 'restock',
          cylinderCode: m.cylinderCode.trim().toUpperCase(),
          quantity: Math.max(1, Math.abs(Math.floor(m.fullDelta || 1))),
          discount: 0,
          note: m.note || '',
        },
      });
    }

    combined.sort((a, b) => a.ts - b.ts);
    const loaded = combined.map((c) => c.event);
    setEvents(loaded);
    setRowNotice(
      loaded.length > 0
        ? `${loaded.length} lançamento(s) carregados de ${formatBrDate(startDate)} a ${formatBrDate(endDate)}.`
        : `Nenhum lançamento encontrado no banco entre ${formatBrDate(startDate)} e ${formatBrDate(endDate)}.`
    );
  };

  const handleUpdateInitial = (code: string, field: 'fullCount' | 'emptyCount', val: number) => {
    const safe = Math.max(0, Math.floor(val || 0));
    setInitialSaved(false);
    setInitialStocks((prev) =>
      prev.map((item) => (item.code === code ? { ...item, [field]: safe } : item))
    );
  };

  const handleUpdateEvent = (id: string, patch: Partial<HistoricalLedgerEventInput>) => {
    setEvents((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              dirtySinceSave: item.savedRecord ? true : item.dirtySinceSave,
            }
          : item
      )
    );
  };

  const handleSaveInitial = async () => {
    setErrorMsg(null);
    setRowNotice(null);
    setSavingInitial(true);
    try {
      await saveInitialStockToFirestore({
        uid,
        existingCylinders: cylinders,
        initialDateStr: startDate,
        initialStocks,
      });
      setInitialSaved(true);
      setRowNotice(`Stock inicial de ${formatBrDate(startDate)} salvo no banco de dados.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar stock inicial.');
    } finally {
      setSavingInitial(false);
    }
  };

  const handleSaveRow = async (ev: HistoricalLedgerEventInput, index: number) => {
    setErrorMsg(null);
    setRowNotice(null);
    setSavingRowId(ev.id);
    try {
      const savedRecord = await saveSingleHistoricalEvent({
        uid,
        existingCylinders: cylinders,
        event: ev,
        seqIndex: index,
      });
      setEvents((prev) =>
        prev.map((item) =>
          item.id === ev.id ? { ...item, savedRecord, dirtySinceSave: false } : item
        )
      );
      setRowNotice(
        `${KIND_LABELS[ev.kind]} (${ev.quantity}x ${ev.cylinderCode} em ${formatBrDate(ev.dateStr)}) salvo no banco de dados.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar linha no banco de dados.');
    } finally {
      setSavingRowId(null);
    }
  };

  const handleRemoveEvent = async (ev: HistoricalLedgerEventInput) => {
    setErrorMsg(null);
    setRowNotice(null);
    if (ev.savedRecord) {
      setSavingRowId(ev.id);
      try {
        await deleteSingleHistoricalEvent({
          uid,
          existingCylinders: cylinders,
          savedRecord: ev.savedRecord,
        });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Erro ao remover registro salvo.');
        setSavingRowId(null);
        return;
      } finally {
        setSavingRowId(null);
      }
    }
    setEvents((prev) => prev.filter((item) => item.id !== ev.id));
  };

  const handleAddEvent = () => {
    const defaultDate = events.length > 0 ? events[events.length - 1].dateStr : startDate;
    const defaultCode =
      initialStocks[0]?.code ?? cylinders[0]?.code.toUpperCase() ?? 'P9';
    setEvents((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        dateStr: defaultDate,
        kind: 'sale',
        cylinderCode: defaultCode,
        quantity: 1,
        discount: 0,
      },
    ]);
  };

  const handlePullCurrentStock = () => {
    setInitialStocks(buildInitialStocksFromCylinders(cylinders));
    setInitialSaved(false);
    setErrorMsg(null);
    setRowNotice('Stock inicial atualizado com os saldos atuais dos botijões.');
  };

  const handleClearTable = () => {
    setEvents([]);
    setRowNotice(null);
    setErrorMsg(null);
  };

  const handleApply = async () => {
    setErrorMsg(null);
    setRowNotice(null);
    setApplying(true);
    try {
      const salesToDelete =
        discardScope === 'all_ledger'
          ? sales
          : discardScope === 'today_only'
            ? todayItems.sales
            : periodItems.sales;

      const movementsToDelete =
        discardScope === 'all_ledger'
          ? movements
          : discardScope === 'today_only'
            ? todayItems.movements
            : periodItems.movements;

      const expensesToDelete = discardScope === 'today_only' ? todayItems.expenses : [];

      const { finalStockByCode } = await applyHistoricalLedgerRebuild({
        uid,
        existingCylinders: cylinders,
        salesToDelete,
        movementsToDelete,
        expensesToDelete,
        initialDateStr: startDate,
        initialStocks,
        events,
      });

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(getHistoricalDraftKey(uid));
      }

      const summaryText = Object.entries(finalStockByCode)
        .map(([code, st]) => `${code}: ${st.full} cheios / ${st.empty} vazios`)
        .join(' · ');

      onSuccess(
        `Histórico aplicado (${formatBrDate(startDate)} a ${formatBrDate(endDate)}, ${simulation.totalSalesCount} vendas gravadas). Stock final — ${summaryText}.`
      );
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao aplicar correção no banco de dados.'
      );
    } finally {
      setApplying(false);
    }
  };

  const availableCodes = Array.from(
    new Set([
      ...cylinders.map((c) => c.code.trim().toUpperCase()),
      ...initialStocks.map((s) => s.code.trim().toUpperCase()),
      ...events.map((e) => e.cylinderCode.trim().toUpperCase()),
    ])
  ).filter(Boolean);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reconstrução de Histórico"
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/80 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-5xl max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden shadow-xl my-auto">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <History className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                  Reconstruir Histórico
                </h3>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60">
                  Rascunho salvo no dispositivo
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Escolha o período manual (De – Até), arraste as linhas para reordenar e salve linha por linha ou tudo de uma vez.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-5 space-y-6">
          {errorMsg && (
            <div
              role="alert"
              className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg p-3 text-xs text-red-800 dark:text-red-300"
            >
              {errorMsg}
            </div>
          )}

          {rowNotice && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-lg p-3 flex items-center gap-2 text-xs text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>{rowNotice}</span>
            </div>
          )}

          {/* 1. Manual Date Range Selection */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  1. Selecionar Período Manualmente (De — Até)
                </p>
              </div>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                No período: {periodItems.sales.length} vendas · {periodItems.movements.length} mov.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Data Inicial (De)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Data Final (Até)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <button
                  type="button"
                  onClick={handleLoadPeriodFromDb}
                  className="w-full h-9 inline-flex items-center justify-center gap-1.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  <Database className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" />
                  <span>Carregar Lançamentos do Período</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Scope of discard */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              2. O que fazer com os registros atuais ao aplicar tudo?
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer ${
                  discardScope === 'selected_period'
                    ? 'border-orange-600 bg-orange-50/70 dark:bg-orange-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="discardScope"
                  checked={discardScope === 'selected_period'}
                  onChange={() => setDiscardScope('selected_period')}
                  className="mt-0.5 text-orange-600"
                />
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Substituir período selecionado ({periodItems.sales.length}v · {periodItems.movements.length}m)
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    Remove apenas registros de {formatBrDate(startDate)} a {formatBrDate(endDate)} e grava esta lista.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer ${
                  discardScope === 'today_only'
                    ? 'border-orange-600 bg-orange-50/70 dark:bg-orange-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="discardScope"
                  checked={discardScope === 'today_only'}
                  onChange={() => setDiscardScope('today_only')}
                  className="mt-0.5 text-orange-600"
                />
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Descartar apenas hoje ({todayCounts.sales}v · {todayCounts.movements}m)
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    Remove os lançamentos de hoje, mantém datas antigas e grava a tabela abaixo.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer ${
                  discardScope === 'all_ledger'
                    ? 'border-orange-600 bg-orange-50/70 dark:bg-orange-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="discardScope"
                  checked={discardScope === 'all_ledger'}
                  onChange={() => setDiscardScope('all_ledger')}
                  className="mt-0.5 text-orange-600"
                />
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Substituir todo o histórico ({sales.length}v · {movements.length}m)
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    Descarta todas as vendas e movimentações anteriores e recria apenas esta lista.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* 3. Initial Stock at startDate */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                3. Stock Inicial em {formatBrDate(startDate)}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handlePullCurrentStock}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Puxar estoque atual</span>
                </button>
                <button
                  type="button"
                  disabled={savingInitial}
                  onClick={handleSaveInitial}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    initialSaved
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60'
                      : 'bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700'
                  } disabled:opacity-50`}
                >
                  {initialSaved ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Inicial Salvo</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingInitial ? 'Salvando...' : 'Salvar Stock Inicial'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {initialStocks.map((item) => (
                <div
                  key={item.code}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-2"
                >
                  <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    {item.code}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                        Cheios
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.fullCount}
                        onChange={(e) =>
                          handleUpdateInitial(item.code, 'fullCount', Number(e.target.value))
                        }
                        className="w-full h-8 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                        Vazios
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.emptyCount}
                        onChange={(e) =>
                          handleUpdateInitial(item.code, 'emptyCount', Number(e.target.value))
                        }
                        className="w-full h-8 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Drag-and-Drop Chronological Events Table */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  4. Movimentações e Vendas ({formatBrDate(startDate)} a {formatBrDate(endDate)}) — {events.length} lançamentos
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Arraste pelo ícone lateral (⋮⋮) para reordenar as linhas — o saldo após cada movimento recalcula na hora.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {events.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearTable}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Limpar</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddEvent}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar linha</span>
                </button>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-medium">
                    <th className="py-2 pl-2.5 pr-1 w-8" aria-label="Reordenar" />
                    <th className="py-2 px-2.5">Data</th>
                    <th className="py-2 px-2.5">Tipo</th>
                    <th className="py-2 px-2.5">Botijão</th>
                    <th className="py-2 px-2.5 text-right">Qtd</th>
                    <th className="py-2 px-2.5 text-right">Desconto</th>
                    <th className="py-2 px-2.5 text-right">Saldo Após</th>
                    <th className="py-2 px-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {events.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 px-4 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        Nenhum lançamento na tabela. Clique em{' '}
                        <strong className="text-slate-700 dark:text-slate-200">
                          &ldquo;Carregar Lançamentos do Período&rdquo;
                        </strong>{' '}
                        acima ou em{' '}
                        <strong className="text-slate-700 dark:text-slate-200">
                          &ldquo;Adicionar linha&rdquo;
                        </strong>{' '}
                        para montar o histórico manualmente.
                      </td>
                    </tr>
                  ) : (
                    events.map((ev, idx) => {
                      const bal = simulation.rowBalances[ev.id];
                      const isSavingThis = savingRowId === ev.id;
                      const isSavedClean = Boolean(ev.savedRecord) && !ev.dirtySinceSave;
                      const isDirtySaved = Boolean(ev.savedRecord) && Boolean(ev.dirtySinceSave);
                      const isDraggingThis = draggedId === ev.id;
                      const isDropBefore =
                        dropTarget?.id === ev.id && dropTarget.position === 'before';
                      const isDropAfter =
                        dropTarget?.id === ev.id && dropTarget.position === 'after';

                      return (
                        <tr
                          key={ev.id}
                          data-ledger-row-id={ev.id}
                          draggable={armedDragId === ev.id}
                          onDragStart={(e) => {
                            setDraggedId(ev.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', ev.id);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (!draggedId || draggedId === ev.id) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const position: DropPosition =
                              e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                            setDropTarget({ id: ev.id, position });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedId && draggedId !== ev.id) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const position: DropPosition =
                                e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                              moveEventRow(draggedId, ev.id, position);
                            }
                            setDraggedId(null);
                            setArmedDragId(null);
                            setDropTarget(null);
                          }}
                          onDragEnd={() => {
                            setDraggedId(null);
                            setArmedDragId(null);
                            setDropTarget(null);
                          }}
                          className={`transition-colors ${
                            isDraggingThis
                              ? 'opacity-45 bg-orange-50/70 dark:bg-orange-950/30'
                              : bal?.negativeWarning
                                ? 'bg-red-50/70 dark:bg-red-950/30'
                                : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                          } ${isDropBefore ? 'shadow-[inset_0_2px_0_0_#ea580c]' : ''} ${
                            isDropAfter ? 'shadow-[inset_0_-2px_0_0_#ea580c]' : ''
                          }`}
                        >
                          <td className="py-1.5 pl-2 pr-1">
                            <button
                              type="button"
                              aria-label="Arrastar linha para reordenar"
                              title="Arrastar para reordenar"
                              onMouseDown={() => setArmedDragId(ev.id)}
                              onMouseUp={() => setArmedDragId(null)}
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                setTouchDragId(ev.id);
                                setDraggedId(ev.id);
                              }}
                              className="p-1 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 cursor-grab active:cursor-grabbing touch-none rounded select-none"
                            >
                              <GripVertical className="w-4 h-4" />
                            </button>
                          </td>
                          <td className="py-1.5 px-2">
                            <input
                              type="date"
                              value={ev.dateStr}
                              onChange={(e) => handleUpdateEvent(ev.id, { dateStr: e.target.value })}
                              className="h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-[11px] text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <select
                              value={ev.kind}
                              onChange={(e) =>
                                handleUpdateEvent(ev.id, {
                                  kind: e.target.value as HistoricalEventKind,
                                })
                              }
                              className="h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[11px] text-slate-900 dark:text-slate-100"
                            >
                              {Object.entries(KIND_LABELS).map(([k, lbl]) => (
                                <option key={k} value={k}>
                                  {lbl}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-2">
                            <select
                              value={ev.cylinderCode}
                              onChange={(e) =>
                                handleUpdateEvent(ev.id, { cylinderCode: e.target.value })
                              }
                              className="h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100"
                            >
                              {availableCodes.map((code) => (
                                <option key={code} value={code}>
                                  {code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            <input
                              type="number"
                              min={1}
                              value={ev.quantity}
                              onChange={(e) =>
                                handleUpdateEvent(ev.id, {
                                  quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                                })
                              }
                              className="w-16 h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-right font-mono text-[11px] text-slate-900 dark:text-slate-100"
                            />
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            {ev.kind === 'sale' ? (
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={ev.discount}
                                onChange={(e) =>
                                  handleUpdateEvent(ev.id, {
                                    discount: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                className="w-20 h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-right font-mono text-[11px] text-slate-900 dark:text-slate-100"
                              />
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                            {bal && (
                              <span
                                className={
                                  bal.negativeWarning
                                    ? 'text-red-700 dark:text-red-400 font-semibold'
                                    : 'text-slate-700 dark:text-slate-300'
                                }
                              >
                                {bal.full} ch / {bal.empty} vz
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={isSavingThis || applying}
                                onClick={() => handleSaveRow(ev, idx)}
                                title={
                                  isSavedClean
                                    ? 'Linha salva no banco de dados'
                                    : isDirtySaved
                                      ? 'Atualizar esta linha no banco de dados'
                                      : 'Salvar apenas esta linha no banco de dados'
                                }
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                                  isSavedClean
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                                    : isDirtySaved
                                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                                      : 'bg-slate-900 dark:bg-orange-600 text-white hover:bg-slate-800 dark:hover:bg-orange-700'
                                }`}
                              >
                                {isSavingThis ? (
                                  <span>...</span>
                                ) : isSavedClean ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Salvo</span>
                                  </>
                                ) : (
                                  <>
                                    <Save className="w-3 h-3" />
                                    <span>{isDirtySaved ? 'Atualizar' : 'Salvar'}</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={isSavingThis || applying}
                                onClick={() => handleRemoveEvent(ev)}
                                title="Remover linha"
                                className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded cursor-pointer disabled:opacity-40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Summary Preview */}
          <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>Prévia do Resultado em {formatBrDate(endDate)}</span>
              </div>
              <span className="font-mono text-xs text-emerald-900 dark:text-emerald-300">
                {simulation.totalSalesCount} vendas · {simulation.totalUnitsSold} botijões · Bruto:{' '}
                {formatCurrency(simulation.totalSalesRevenue, currency)}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs font-mono">
              {Object.entries(simulation.finalState).map(([code, st]) => (
                <div
                  key={code}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60 text-slate-900 dark:text-slate-100"
                >
                  <strong>{code}:</strong> {st.full} cheios · {st.empty} vazios
                </div>
              ))}
            </div>
            {simulation.hasNegativeWarning && (
              <p className="text-xs text-red-700 dark:text-red-400 font-medium pt-1">
                Atenção: uma ou mais linhas ficaram sem botijões cheios suficientes antes da venda (destacadas em vermelho).
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 shrink-0 bg-slate-50/70 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={handleAddEvent}
            disabled={applying}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova Linha</span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={applying || events.length === 0}
              onClick={handleApply}
              className="px-5 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
            >
              {applying ? 'Gravando no banco de dados...' : 'Aplicar Tudo no Banco de Dados'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
