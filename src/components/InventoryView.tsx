import {
  AlertTriangle,
  ArrowDownToLine,
  Calculator,
  Coins,
  Crop,
  Edit3,
  ImagePlus,
  Package,
  PackagePlus,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import cylinderStudioImg from '../assets/images/gas_cylinder_studio_1794631289411.jpg';
import { formatCurrency, formatDateTime, getRecordTimestamp } from '../lib/formatters';
import { readFileAsDataUrl } from '../lib/imageUtils';
import {
  getTodayIsoDate,
  parseStrictNumber,
  preventNegativeNumberKeys,
  sanitizeNumericText,
  validateCylinderForm,
  validateStockMovementForm,
} from '../lib/validation';
import {
  adjustCylinderStock,
  createCylinder,
  updateCylinderCatalog,
} from '../services/depotService';
import {
  type AppSection,
  type CurrencyCode,
  type Cylinder,
  FIELD_LIMITS,
  type MemberPermissions,
  MOVEMENT_TYPE_LABELS,
  type StockMovement,
} from '../types/gas';
import { ImageCropperModal } from './ImageCropperModal';
import { StockHealthLabel } from './StatusLabel';

interface InventoryViewProps {
  uid: string;
  currency: CurrencyCode;
  cylinders: Cylinder[];
  movements: StockMovement[];
  permissions: MemberPermissions;
  onNavigate?: (section: AppSection) => void;
}

export function InventoryView({
  uid,
  currency,
  cylinders,
  movements,
  permissions,
  onNavigate,
}: InventoryViewProps) {
  const [stockModalCylId, setStockModalCylId] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<
    'restock' | 'return_empty' | 'adjustment' | 'calculator'
  >('restock');
  const [fullQtyInput, setFullQtyInput] = useState<string>('10');
  const [emptyQtyInput, setEmptyQtyInput] = useState<string>('10');
  const [movementNote, setMovementNote] = useState<string>('');
  const [movementDate, setMovementDate] = useState<string>('');
  const [savingStock, setSavingStock] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [calcSelected, setCalcSelected] = useState<Record<string, boolean>>({});
  const [calcQtyInputs, setCalcQtyInputs] = useState<Record<string, string>>({});

  const [editModalCyl, setEditModalCyl] = useState<Cylinder | null>(null);
  const [editForm, setEditForm] = useState({
    code: '',
    name: '',
    weightKg: '13',
    salePrice: '0',
    shellPrice: '0',
    costPrice: '0',
    minStock: '5',
    imageUrl: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editCylError, setEditCylError] = useState<string | null>(null);

  const [showNewCylModal, setShowNewCylModal] = useState(false);
  const [newCylForm, setNewCylForm] = useState({
    code: '',
    name: '',
    weightKg: '13',
    fullCount: '10',
    emptyCount: '0',
    salePrice: '115',
    shellPrice: '185',
    costPrice: '80',
    minStock: '5',
    imageUrl: '',
  });
  const [savingNewCyl, setSavingNewCyl] = useState(false);
  const [newCylError, setNewCylError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [cropSession, setCropSession] = useState<{ target: 'new' | 'edit'; src: string } | null>(
    null
  );
  const [rawImageSources, setRawImageSources] = useState<{ new?: string; edit?: string }>({});

  const stockModalCyl = cylinders.find((c) => c.id === stockModalCylId) ?? null;

  const initCalculatorState = (preselectId?: string | null) => {
    const nextQty: Record<string, string> = {};
    for (const c of cylinders) {
      nextQty[c.id] = String(c.emptyCount);
    }
    setCalcQtyInputs(nextQty);
    setCalcSelected(preselectId ? { [preselectId]: true } : {});
  };

  const openStockModal = (
    cyl: Cylinder | null,
    type: 'restock' | 'return_empty' | 'adjustment' | 'calculator',
    preselectCalcId?: string | null
  ) => {
    const target = cyl ?? cylinders[0] ?? null;
    if (!target) {
      setNewCylError(null);
      setShowNewCylModal(true);
      return;
    }
    setStockError(null);
    setStockModalCylId(target.id);
    setMovementType(type);
    setFullQtyInput(
      String(
        type === 'restock' || type === 'calculator'
          ? target.emptyCount
          : type === 'adjustment'
            ? target.fullCount
            : 0
      )
    );
    setEmptyQtyInput(
      String(
        type === 'restock' || type === 'calculator'
          ? target.emptyCount
          : type === 'return_empty'
            ? 5
            : target.emptyCount
      )
    );
    setMovementNote('');
    setMovementDate('');
    initCalculatorState(preselectCalcId);
  };

  const handleSelectStockCylinder = (cylId: string) => {
    const target = cylinders.find((c) => c.id === cylId);
    if (!target) return;
    setStockError(null);
    setStockModalCylId(target.id);
    if (movementType === 'restock') {
      setFullQtyInput(String(target.emptyCount));
      setEmptyQtyInput(String(target.emptyCount));
    } else if (movementType === 'adjustment') {
      setFullQtyInput(String(target.fullCount));
      setEmptyQtyInput(String(target.emptyCount));
    }
  };

  const openEditModal = (cyl: Cylinder) => {
    setImageError(null);
    setEditCylError(null);
    setRawImageSources((prev) => ({ ...prev, edit: undefined }));
    setEditModalCyl(cyl);
    setEditForm({
      code: cyl.code,
      name: cyl.name,
      weightKg: String(cyl.weightKg),
      salePrice: String(cyl.salePrice),
      shellPrice: String(cyl.shellPrice),
      costPrice: String(cyl.costPrice),
      minStock: String(cyl.minStock),
      imageUrl: cyl.imageUrl || '',
    });
  };

  const handleImageUpload = async (file: File | undefined, target: 'new' | 'edit') => {
    if (!file) return;
    setImageError(null);
    try {
      const rawDataUrl = await readFileAsDataUrl(file);
      setRawImageSources((prev) => ({ ...prev, [target]: rawDataUrl }));
      setCropSession({ target, src: rawDataUrl });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Erro ao carregar a imagem.');
    }
  };

  const handleOpenImageEditor = (target: 'new' | 'edit') => {
    setImageError(null);
    const currentUrl = target === 'new' ? newCylForm.imageUrl : editForm.imageUrl;
    const rawUrl = rawImageSources[target];
    const src = rawUrl || currentUrl;
    if (!src) return;
    setCropSession({ target, src });
  };

  const handleCropConfirmed = (croppedDataUrl: string) => {
    if (!cropSession) return;
    if (cropSession.target === 'new') {
      setNewCylForm((f) => ({ ...f, imageUrl: croppedDataUrl }));
    } else {
      setEditForm((f) => ({ ...f, imageUrl: croppedDataUrl }));
    }
    setCropSession(null);
  };

  const handleSaveStock = async (e: FormEvent) => {
    e.preventDefault();
    if (!stockModalCyl || movementType === 'calculator') return;
    setStockError(null);

    const validation = validateStockMovementForm({
      movementType,
      fullQty: fullQtyInput,
      emptyQty: emptyQtyInput,
      currentFull: stockModalCyl.fullCount,
      currentEmpty: stockModalCyl.emptyCount,
      note: movementNote,
      movementDate,
    });
    if (!validation.ok) {
      setStockError(validation.error);
      return;
    }

    const { fullDelta, emptyDelta, note, occurredAt } = validation.data;
    let resolvedNote = note;
    if (movementType === 'restock' && !resolvedNote && fullDelta > 0) {
      const returnedEmpties = Math.abs(emptyDelta);
      if (fullDelta > returnedEmpties) {
        resolvedNote =
          returnedEmpties > 0
            ? 'Reposição e Aquisição completa'
            : 'Aquisição completa';
      } else {
        resolvedNote = 'Reposição de carga';
      }
    }

    setSavingStock(true);
    try {
      await adjustCylinderStock(
        uid,
        stockModalCyl,
        movementType,
        fullDelta,
        emptyDelta,
        resolvedNote,
        occurredAt
      );
      setStockModalCylId(null);
    } catch (err) {
      setStockError(err instanceof Error ? err.message : 'Erro ao movimentar estoque.');
    } finally {
      setSavingStock(false);
    }
  };

  const handleApplyCalculatorRestock = async () => {
    setStockError(null);
    const chosen = cylinders.filter((c) => Boolean(calcSelected[c.id]));
    if (chosen.length === 0) {
      setStockError('Selecione pelo menos um tipo de botijão na calculadora.');
      return;
    }

    const entries: Array<{
      cyl: Cylinder;
      fullDelta: number;
      emptyDelta: number;
      note: string;
    }> = [];

    for (const cyl of chosen) {
      const raw = calcQtyInputs[cyl.id] ?? String(cyl.emptyCount);
      const parsed = parseStrictNumber(raw);
      if (parsed === null || parsed < 0 || !Number.isInteger(parsed) || parsed > 10000) {
        setStockError(`Informe uma quantidade inteira válida (0 a 10.000) para ${cyl.code}.`);
        return;
      }
      if (parsed === 0) continue;
      const usedEmpties = Math.min(parsed, cyl.emptyCount);
      const acquisitionQty = parsed - usedEmpties;
      const note =
        acquisitionQty > 0
          ? usedEmpties > 0
            ? 'Reposição e Aquisição completa (Calculadora)'
            : 'Aquisição completa (Calculadora)'
          : 'Reposição de carga (Calculadora)';

      entries.push({
        cyl,
        fullDelta: parsed,
        emptyDelta: -usedEmpties,
        note,
      });
    }

    if (entries.length === 0) {
      setStockError('Informe pelo menos 1 botijão com quantidade maior que zero para registrar.');
      return;
    }

    setSavingStock(true);
    try {
      for (const item of entries) {
        await adjustCylinderStock(
          uid,
          item.cyl,
          'restock',
          item.fullDelta,
          item.emptyDelta,
          item.note
        );
      }
      setStockModalCylId(null);
    } catch (err) {
      setStockError(err instanceof Error ? err.message : 'Erro ao registrar reposição.');
    } finally {
      setSavingStock(false);
    }
  };

  const handleSaveCatalog = async (e: FormEvent) => {
    e.preventDefault();
    if (!editModalCyl) return;
    setEditCylError(null);

    const validation = validateCylinderForm(editForm, {
      isCreate: false,
      existingCodes: cylinders.map((c) => c.code),
      currentCode: editModalCyl.code,
    });
    if (!validation.ok) {
      setEditCylError(validation.error);
      return;
    }

    setSavingEdit(true);
    try {
      await updateCylinderCatalog(uid, editModalCyl.id, validation.data);
      setEditModalCyl(null);
    } catch (err) {
      setEditCylError(err instanceof Error ? err.message : 'Erro ao atualizar produto.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreateCylinder = async (e: FormEvent) => {
    e.preventDefault();
    setNewCylError(null);

    const validation = validateCylinderForm(newCylForm, {
      isCreate: true,
      existingCodes: cylinders.map((c) => c.code),
    });
    if (!validation.ok) {
      setNewCylError(validation.error);
      return;
    }

    setSavingNewCyl(true);
    try {
      await createCylinder(uid, validation.data);
      setShowNewCylModal(false);
      setNewCylForm({
        code: '',
        name: '',
        weightKg: '13',
        fullCount: '10',
        emptyCount: '0',
        salePrice: '115',
        shellPrice: '185',
        costPrice: '80',
        minStock: '5',
        imageUrl: '',
      });
      setImageError(null);
      setNewCylError(null);
      setRawImageSources((prev) => ({ ...prev, new: undefined }));
    } catch (err) {
      setNewCylError(err instanceof Error ? err.message : 'Erro ao cadastrar produto.');
    } finally {
      setSavingNewCyl(false);
    }
  };

  const totalFull = cylinders.reduce((acc, c) => acc + c.fullCount, 0);
  const totalEmpty = cylinders.reduce((acc, c) => acc + c.emptyCount, 0);
  const inventoryValue = cylinders.reduce((acc, c) => acc + c.fullCount * c.costPrice, 0);
  const emptyInventoryValue = cylinders.reduce((acc, c) => acc + c.emptyCount * c.costPrice, 0);
  const belowMinimumCylinders = cylinders.filter(
    (c) => c.fullCount === 0 || c.fullCount < c.minStock
  );
  const hasCriticalOutOfStock = belowMinimumCylinders.some((c) => c.fullCount === 0);

  return (
    <div className="space-y-8">
      {/* Low Stock Visual Alert */}
      {belowMinimumCylinders.length > 0 && (
        <section
          role="alert"
          className={`rounded-xl border p-5 space-y-4 ${
            hasCriticalOutOfStock
              ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60 text-red-950 dark:text-red-100'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-950 dark:text-amber-100'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  hasCriticalOutOfStock
                    ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                    : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-sm font-semibold">
                  {belowMinimumCylinders.length === 1
                    ? 'Alerta de Estoque: 1 tipo de botijão abaixo do limite mínimo'
                    : `Alerta de Estoque: ${belowMinimumCylinders.length} tipos de botijão abaixo do limite mínimo`}
                </h2>
                <p
                  className={`text-xs mt-0.5 ${
                    hasCriticalOutOfStock ? 'text-red-800 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'
                  }`}
                >
                  O saldo de botijões cheios está inferior ao limite configurado para a distribuidora.
                </p>
              </div>
            </div>

            {onNavigate && (permissions.manageSettings || permissions.manageInventory) && (
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap cursor-pointer ${
                  hasCriticalOutOfStock
                    ? 'border-red-200 dark:border-red-800/70 bg-white dark:bg-slate-900 text-red-900 dark:text-red-200 hover:bg-red-100/60 dark:hover:bg-red-950/60'
                    : 'border-amber-200 dark:border-amber-800/70 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-950/60'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Ajustar Limites</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {belowMinimumCylinders.map((cyl) => {
              const deficit = Math.max(0, cyl.minStock - cyl.fullCount);
              const isOut = cyl.fullCount === 0;
              return (
                <div
                  key={cyl.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                        {cyl.code}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          isOut ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {isOut ? 'Esgotado' : `Faltam ${deficit} un`}
                      </span>
                    </div>
                    <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400 mt-0.5">
                      Atual: {cyl.fullCount} cheios · Mínimo: {cyl.minStock}
                    </p>
                  </div>
                  {permissions.manageInventory && (
                    <button
                      type="button"
                      onClick={() => openStockModal(cyl, 'restock')}
                      className="px-2.5 py-1.5 rounded-md bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Repor
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total de Botijões Cheios
            </p>
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
              {totalFull} unidades
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
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total de Cascos Vazios
            </p>
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
              {totalEmpty} cascos
            </p>
          </div>
          <div
            aria-hidden="true"
            className="w-11 h-11 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0"
          >
            <RefreshCw className="w-5 h-5" />
          </div>
        </div>

        {permissions.viewFinance && (
          <>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Capital Imobilizado (Custo Cheios)
                </p>
                <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
                  {formatCurrency(inventoryValue, currency)}
                </p>
              </div>
              <div
                aria-hidden="true"
                className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0"
              >
                <Wallet className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Capital Imobilizado (Custo dos Vazios)
                </p>
                <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
                  {formatCurrency(emptyInventoryValue, currency)}
                </p>
              </div>
              <div
                aria-hidden="true"
                className="w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0"
              >
                <Coins className="w-5 h-5" />
              </div>
            </div>
          </>
        )}
      </section>

      {/* Cylinder Catalog & Stock Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Catálogo e Controle de Stock
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Adicione novos tipos de botijões, registre entradas de carga ou atualize preços
            </p>
          </div>

          {permissions.manageInventory && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setImageError(null);
                  setNewCylError(null);
                  setShowNewCylModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Novo Botijão / Produto</span>
              </button>
              <button
                type="button"
                onClick={() => openStockModal(cylinders[0] ?? null, 'restock')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Adicionar Stock</span>
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Produto</th>
                <th className="py-3 px-4 text-right">Cheios</th>
                <th className="py-3 px-4 text-right">Vazios</th>
                <th className="py-3 px-4 text-right">Mínimo</th>
                <th className="py-3 px-4 text-right">Preço Troca</th>
                <th className="py-3 px-4 text-right">Casco Novo</th>
                {permissions.viewFinance && <th className="py-3 px-4 text-right">Margem</th>}
                <th className="py-3 px-4">Situação</th>
                {permissions.manageInventory && <th className="py-3 px-4 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {cylinders.map((cyl) => {
                const margin = cyl.salePrice - cyl.costPrice;
                const isOut = cyl.fullCount === 0;
                const isBelowMin = cyl.fullCount < cyl.minStock;
                return (
                  <tr
                    key={cyl.id}
                    className={
                      isOut
                        ? 'bg-red-50/40 dark:bg-red-950/25 hover:bg-red-50/70 dark:hover:bg-red-950/40'
                        : isBelowMin
                          ? 'bg-amber-50/50 dark:bg-amber-950/25 hover:bg-amber-50/80 dark:hover:bg-amber-950/40'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden shrink-0">
                          <img
                            src={cyl.imageUrl || cylinderStudioImg}
                            alt={cyl.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-display font-semibold text-slate-900 dark:text-slate-100">{cyl.code}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{cyl.name}</div>
                        </div>
                      </div>
                    </td>
                    <td
                      className={`py-3.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        isOut
                          ? 'text-red-700 dark:text-red-400'
                          : isBelowMin
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {cyl.fullCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {cyl.emptyCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {cyl.minStock}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(cyl.salePrice, currency)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCurrency(cyl.shellPrice, currency)}
                    </td>
                    {permissions.viewFinance && (
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-medium">
                        {formatCurrency(margin, currency)}
                      </td>
                    )}
                    <td className="py-3.5 px-4">
                      <StockHealthLabel fullCount={cyl.fullCount} minStock={cyl.minStock} />
                    </td>
                    {permissions.manageInventory && (
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openStockModal(cyl, 'restock')}
                            className="px-2.5 py-1.5 rounded-md bg-slate-900 dark:bg-orange-600 text-white text-xs font-medium hover:bg-slate-800 dark:hover:bg-orange-700 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            <span>Entrada</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openStockModal(cyl, 'adjustment')}
                            title="Ajustar contagem manual"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(cyl)}
                            title="Editar preços e mínimo"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Movements Log */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Histórico de Movimentações
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Auditoria automática de vendas, entradas de carga e ajustes de pátio
          </p>
        </div>

        {movements.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhuma movimentação registrada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Data</th>
                  <th className="py-2.5 px-4">Botijão</th>
                  <th className="py-2.5 px-4">Tipo</th>
                  <th className="py-2.5 px-4 text-right">Cheios</th>
                  <th className="py-2.5 px-4 text-right">Vazios</th>
                  <th className="py-2.5 px-4">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {movements.slice(0, 20).map((mov) => (
                  <tr key={mov.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTime(getRecordTimestamp(mov))}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">{mov.cylinderCode}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-700 dark:text-slate-300">
                      {MOVEMENT_TYPE_LABELS[mov.movementType]}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        mov.fullDelta > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : mov.fullDelta < 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {mov.fullDelta > 0 ? `+${mov.fullDelta}` : mov.fullDelta}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        mov.emptyDelta > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : mov.emptyDelta < 0
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {mov.emptyDelta > 0 ? `+${mov.emptyDelta}` : mov.emptyDelta}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400">{mov.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Stock Adjustment & Calculator Modal */}
      {stockModalCyl && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {movementType === 'calculator' ? (
                  <Calculator className="w-4 h-4 text-orange-600 dark:text-orange-500" />
                ) : (
                  <ArrowDownToLine className="w-4 h-4 text-orange-600 dark:text-orange-500" />
                )}
                <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Adicionar / Movimentar Stock
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setStockModalCylId(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setStockError(null);
                  setMovementType('restock');
                  setFullQtyInput(String(stockModalCyl.emptyCount));
                  setEmptyQtyInput(String(stockModalCyl.emptyCount));
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                  movementType === 'restock'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Entrada Carga
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockError(null);
                  setMovementType('return_empty');
                  setFullQtyInput('0');
                  setEmptyQtyInput('5');
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                  movementType === 'return_empty'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Retorno Vazios
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockError(null);
                  setMovementType('adjustment');
                  setFullQtyInput(String(stockModalCyl.fullCount));
                  setEmptyQtyInput(String(stockModalCyl.emptyCount));
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                  movementType === 'adjustment'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Balanço Direto
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockError(null);
                  setMovementType('calculator');
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-md inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  movementType === 'calculator'
                    ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Calculator className="w-3.5 h-3.5 shrink-0" />
                <span>Calculadora</span>
              </button>
            </div>

            {stockError && (
              <div
                role="alert"
                className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg px-3 py-2 text-xs text-red-800 dark:text-red-300 font-medium"
              >
                {stockError}
              </div>
            )}

            {movementType === 'calculator' ? (() => {
              const calcRows = cylinders.map((c) => {
                const checked = Boolean(calcSelected[c.id]);
                const rawQty = calcQtyInputs[c.id] ?? String(c.emptyCount);
                const parsedQty = parseStrictNumber(rawQty);
                const validQty =
                  parsedQty !== null && parsedQty >= 0 && Number.isInteger(parsedQty)
                    ? parsedQty
                    : 0;
                const lineTotal = checked ? validQty * c.costPrice : 0;
                const exceedsEmpties = checked && validQty > c.emptyCount;
                return {
                  cylinder: c,
                  checked,
                  rawQty,
                  validQty,
                  lineTotal,
                  exceedsEmpties,
                };
              });

              const selectedRows = calcRows.filter((r) => r.checked);
              const totalUnits = selectedRows.reduce((acc, r) => acc + r.validQty, 0);
              const totalCost = selectedRows.reduce((acc, r) => acc + r.lineTotal, 0);

              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Selecione os tipos de botijões para calcular o custo total da reposição.
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setStockError(null);
                          const nextSel: Record<string, boolean> = {};
                          const nextQty: Record<string, string> = {};
                          for (const c of cylinders) {
                            nextQty[c.id] = String(c.emptyCount);
                            if (c.emptyCount > 0) nextSel[c.id] = true;
                          }
                          setCalcSelected(nextSel);
                          setCalcQtyInputs(nextQty);
                        }}
                        className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline whitespace-nowrap cursor-pointer"
                      >
                        Com vazios
                      </button>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setStockError(null);
                          const nextSel: Record<string, boolean> = {};
                          for (const c of cylinders) nextSel[c.id] = true;
                          setCalcSelected(nextSel);
                        }}
                        className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline whitespace-nowrap cursor-pointer"
                      >
                        Todos
                      </button>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setStockError(null);
                          setCalcSelected({});
                        }}
                        className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline whitespace-nowrap cursor-pointer"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                    {calcRows.map(({ cylinder: cyl, checked, rawQty, lineTotal, exceedsEmpties }) => (
                      <div
                        key={cyl.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                          checked
                            ? 'bg-orange-50/40 dark:bg-orange-950/20'
                            : 'bg-white dark:bg-slate-950/60'
                        }`}
                      >
                        <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setStockError(null);
                              const isNowChecked = e.target.checked;
                              setCalcSelected((prev) => ({ ...prev, [cyl.id]: isNowChecked }));
                              if (isNowChecked && (!rawQty || rawQty === '0') && cyl.emptyCount > 0) {
                                setCalcQtyInputs((prev) => ({
                                  ...prev,
                                  [cyl.id]: String(cyl.emptyCount),
                                }));
                              }
                            }}
                            className="mt-1 rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {cyl.code}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {cyl.name}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                              {cyl.emptyCount} vazios · Custo: {formatCurrency(cyl.costPrice, currency)}/un
                            </p>
                            {exceedsEmpties && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium mt-0.5">
                                Acima dos vazios no pátio ({cyl.emptyCount})
                              </p>
                            )}
                          </div>
                        </label>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="w-20">
                            <label className="sr-only" htmlFor={`calc-qty-${cyl.id}`}>
                              Quantidade {cyl.code}
                            </label>
                            <input
                              id={`calc-qty-${cyl.id}`}
                              type="number"
                              min={0}
                              max={10000}
                              step={1}
                              value={rawQty}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                              onChange={(e) => {
                                const clean = sanitizeNumericText(e.target.value, false);
                                setCalcQtyInputs((prev) => ({ ...prev, [cyl.id]: clean }));
                                setStockError(null);
                                const parsed = parseStrictNumber(clean);
                                if (parsed !== null && parsed > 0 && !checked) {
                                  setCalcSelected((prev) => ({ ...prev, [cyl.id]: true }));
                                }
                              }}
                              className={`w-full h-8 px-2 rounded-lg border text-right font-mono tabular-nums text-xs focus:outline-none focus:border-orange-600 ${
                                checked
                                  ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 dark:text-slate-500'
                              }`}
                            />
                          </div>

                          <div className="w-24 text-right font-mono tabular-nums">
                            <span
                              className={`text-xs font-semibold ${
                                checked
                                  ? 'text-slate-900 dark:text-slate-100'
                                  : 'text-slate-400 dark:text-slate-600'
                              }`}
                            >
                              {formatCurrency(lineTotal, currency)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <span>
                        {selectedRows.length === 0
                          ? 'Nenhum tipo selecionado'
                          : selectedRows
                              .map((r) => `${r.cylinder.code} (${r.validQty})`)
                              .join(' + ')}
                      </span>
                      <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                        {totalUnits} {totalUnits === 1 ? 'botijão' : 'botijões'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-slate-200/80 dark:border-slate-800">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Valor Total de Reposição
                      </span>
                      <span className="font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(totalCost, currency)}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setStockModalCylId(null)}
                      className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      Fechar
                    </button>
                    <button
                      type="button"
                      disabled={savingStock || totalUnits === 0}
                      onClick={() => void handleApplyCalculatorRestock()}
                      className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {savingStock ? 'Registrando...' : 'Confirmar Reposição no Stock'}
                    </button>
                  </div>
                </div>
              );
            })() : (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tipo de Botijão
                  </label>
                  <select
                    value={stockModalCyl.id}
                    onChange={(e) => handleSelectStockCylinder(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  >
                    {cylinders.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name} (Cheios: {c.fullCount} | Vazios: {c.emptyCount})
                      </option>
                    ))}
                  </select>
                </div>

                <form onSubmit={handleSaveStock} noValidate className="space-y-4">
                  {movementType === 'restock' && (() => {
                    const parsedFull = parseStrictNumber(fullQtyInput) ?? 0;
                    const parsedEmpty = parseStrictNumber(emptyQtyInput) ?? 0;
                    const clampedEmpties = Math.min(stockModalCyl.emptyCount, Math.max(0, parsedEmpty));
                    const acquisitionQty = Math.max(0, parsedFull - clampedEmpties);
                    const isMixedAcquisition = parsedFull > clampedEmpties && clampedEmpties > 0;
                    const isPureAcquisition = parsedFull > 0 && clampedEmpties === 0;
                    return (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Botijões Cheios Recebidos (+)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            step={1}
                            value={fullQtyInput}
                            onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                            onChange={(e) => {
                              const clean = sanitizeNumericText(e.target.value, false);
                              setFullQtyInput(clean);
                              setStockError(null);
                              const nextFull = parseStrictNumber(clean) ?? 0;
                              setEmptyQtyInput(String(Math.min(nextFull, stockModalCyl.emptyCount)));
                            }}
                            className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                          />
                          {parsedFull > 0 && (
                            <p
                              className={`text-xs mt-1.5 px-2.5 py-1.5 rounded-md border font-medium ${
                                isMixedAcquisition || isPureAcquisition
                                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300'
                                  : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {isMixedAcquisition
                                ? `Reposição e Aquisição completa: ${clampedEmpties} reposição (troca) + ${acquisitionQty} aquisição completa (com casco).`
                                : isPureAcquisition
                                  ? `Aquisição completa: ${acquisitionQty} botijão(ões) com casco novo (sem vazios entregues).`
                                  : `Reposição: ${parsedFull} botijão(ões) em troca de ${clampedEmpties} vazio(s).`}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Cascos Vazios Entregues ao Fornecedor (-)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={stockModalCyl.emptyCount}
                            step={1}
                            value={emptyQtyInput}
                            onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                            onChange={(e) => {
                              const clean = sanitizeNumericText(e.target.value, false);
                              const parsed = parseStrictNumber(clean);
                              if (parsed !== null && parsed > stockModalCyl.emptyCount) {
                                setEmptyQtyInput(String(stockModalCyl.emptyCount));
                              } else {
                                setEmptyQtyInput(clean);
                              }
                              setStockError(null);
                            }}
                            className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                          />
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                            Disponível no pátio: {stockModalCyl.emptyCount} vazios
                          </p>
                        </div>
                      </>
                    );
                  })()}

                  {movementType === 'return_empty' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Cascos Vazios Devolvidos ao Pátio (+)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        step={1}
                        value={emptyQtyInput}
                        onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                        onChange={(e) => {
                          setEmptyQtyInput(sanitizeNumericText(e.target.value, false));
                          setStockError(null);
                        }}
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                      />
                    </div>
                  )}

                  {movementType === 'adjustment' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Total Cheios Atual
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100000}
                          step={1}
                          value={fullQtyInput}
                          onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                          onChange={(e) => {
                            setFullQtyInput(sanitizeNumericText(e.target.value, false));
                            setStockError(null);
                          }}
                          className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Total Vazios Atual
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100000}
                          step={1}
                          value={emptyQtyInput}
                          onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                          onChange={(e) => {
                            setEmptyQtyInput(sanitizeNumericText(e.target.value, false));
                            setStockError(null);
                          }}
                          className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Observação (ex.: Nota Fiscal / Caminhão)
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.MOVEMENT_NOTE}
                      value={movementNote}
                      onChange={(e) => {
                        setMovementNote(e.target.value);
                        setStockError(null);
                      }}
                      placeholder="Ex.: Carga manhã NF 4021"
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Data da movimentação (opcional — padrão: agora)
                    </label>
                    <input
                      type="date"
                      max={getTodayIsoDate()}
                      value={movementDate}
                      onChange={(e) => {
                        setMovementDate(e.target.value);
                        setStockError(null);
                      }}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setStockModalCylId(null)}
                      className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingStock}
                      className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                    >
                      {savingStock ? 'Salvando...' : 'Confirmar Entrada'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* New Cylinder SKU Modal */}
      {showNewCylModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Novo Botijão / Produto no Stock
              </h3>
              <button
                type="button"
                onClick={() => setShowNewCylModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {newCylError && (
              <div
                role="alert"
                className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg px-3 py-2 text-xs text-red-800 dark:text-red-300 font-medium"
              >
                {newCylError}
              </div>
            )}

            <form onSubmit={handleCreateCylinder} noValidate className="space-y-3">
              {/* Product Photo Picker */}
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Foto do Produto
                </label>
                <div className="flex items-center gap-3.5">
                  <div className="w-16 h-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shrink-0">
                    <img
                      src={newCylForm.imageUrl || cylinderStudioImg}
                      alt="Prévia do produto"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                        <ImagePlus className="w-3.5 h-3.5 text-orange-600 dark:text-orange-500" />
                        <span>{newCylForm.imageUrl ? 'Trocar Foto' : 'Escolher Foto'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            void handleImageUpload(e.target.files?.[0], 'new');
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {newCylForm.imageUrl && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenImageEditor('new')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Crop className="w-3.5 h-3.5 text-orange-600 dark:text-orange-500" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewCylForm((f) => ({ ...f, imageUrl: '' }));
                              setRawImageSources((prev) => ({ ...prev, new: undefined }));
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remover</span>
                          </button>
                        </>
                      )}
                    </div>
                    <input
                      type="url"
                      value={newCylForm.imageUrl.startsWith('data:') ? '' : newCylForm.imageUrl}
                      onChange={(e) => {
                        setRawImageSources((prev) => ({ ...prev, new: undefined }));
                        setNewCylForm((f) => ({ ...f, imageUrl: e.target.value }));
                        setNewCylError(null);
                      }}
                      placeholder="Ou cole o link da imagem (https://...)"
                      className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                    />
                  </div>
                </div>
                {imageError && <p className="text-xs text-red-600 dark:text-red-400">{imageError}</p>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Código *</label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.CYLINDER_CODE}
                    placeholder="Ex.: P11"
                    value={newCylForm.code}
                    onChange={(e) => {
                      setNewCylForm((f) => ({ ...f, code: e.target.value }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição *</label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.CYLINDER_NAME}
                    placeholder="Ex.: Botijão 11 kg"
                    value={newCylForm.name}
                    onChange={(e) => {
                      setNewCylForm((f) => ({ ...f, name: e.target.value }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Peso (kg) *</label>
                  <input
                    type="number"
                    min={0.5}
                    max={1000}
                    step="0.5"
                    value={newCylForm.weightKg}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        weightKg: sanitizeNumericText(e.target.value, true),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Cheios Iniciais *</label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={1}
                    value={newCylForm.fullCount}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        fullCount: sanitizeNumericText(e.target.value, false),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Vazios Iniciais *</label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={1}
                    value={newCylForm.emptyCount}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        emptyCount: sanitizeNumericText(e.target.value, false),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Preço Recarga (Troca) *
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    max={1000000}
                    step="0.50"
                    value={newCylForm.salePrice}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        salePrice: sanitizeNumericText(e.target.value, true),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Adicional Casco Novo *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.50"
                    value={newCylForm.shellPrice}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        shellPrice: sanitizeNumericText(e.target.value, true),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Custo de Reposição *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.50"
                    value={newCylForm.costPrice}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        costPrice: sanitizeNumericText(e.target.value, true),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Alerta Estoque Mínimo *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    value={newCylForm.minStock}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                    onChange={(e) => {
                      setNewCylForm((f) => ({
                        ...f,
                        minStock: sanitizeNumericText(e.target.value, false),
                      }));
                      setNewCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewCylModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingNewCyl}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  {savingNewCyl ? 'Cadastrando...' : 'Criar Produto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Catalog / Pricing Modal */}
      {editModalCyl && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Editar Produto — {editModalCyl.code}
              </h3>
              <button
                type="button"
                onClick={() => setEditModalCyl(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editCylError && (
              <div
                role="alert"
                className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg px-3 py-2 text-xs text-red-800 dark:text-red-300 font-medium"
              >
                {editCylError}
              </div>
            )}

            <form onSubmit={handleSaveCatalog} noValidate className="space-y-3">
              {/* Product Photo Picker */}
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Foto do Produto
                </label>
                <div className="flex items-center gap-3.5">
                  <div className="w-16 h-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shrink-0">
                    <img
                      src={editForm.imageUrl || cylinderStudioImg}
                      alt={editForm.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                        <ImagePlus className="w-3.5 h-3.5 text-orange-600 dark:text-orange-500" />
                        <span>{editForm.imageUrl ? 'Trocar Foto' : 'Escolher Foto'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            void handleImageUpload(e.target.files?.[0], 'edit');
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {editForm.imageUrl && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenImageEditor('edit')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Crop className="w-3.5 h-3.5 text-orange-600 dark:text-orange-500" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditForm((f) => ({ ...f, imageUrl: '' }));
                              setRawImageSources((prev) => ({ ...prev, edit: undefined }));
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remover</span>
                          </button>
                        </>
                      )}
                    </div>
                    <input
                      type="url"
                      value={editForm.imageUrl.startsWith('data:') ? '' : editForm.imageUrl}
                      onChange={(e) => {
                        setRawImageSources((prev) => ({ ...prev, edit: undefined }));
                        setEditForm((f) => ({ ...f, imageUrl: e.target.value }));
                        setEditCylError(null);
                      }}
                      placeholder="Ou cole o link da imagem (https://...)"
                      className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                    />
                  </div>
                </div>
                {imageError && <p className="text-xs text-red-600 dark:text-red-400">{imageError}</p>}
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Código *</label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.CYLINDER_CODE}
                    value={editForm.code}
                    onChange={(e) => {
                      setEditForm((f) => ({ ...f, code: e.target.value }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.CYLINDER_NAME}
                    value={editForm.name}
                    onChange={(e) => {
                      setEditForm((f) => ({ ...f, name: e.target.value }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Peso (kg) *</label>
                  <input
                    type="number"
                    min={0.5}
                    max={1000}
                    step="0.5"
                    value={editForm.weightKg}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setEditForm((f) => ({
                        ...f,
                        weightKg: sanitizeNumericText(e.target.value, true),
                      }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Preço Recarga (Troca) *
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    max={1000000}
                    step="0.50"
                    value={editForm.salePrice}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setEditForm((f) => ({
                        ...f,
                        salePrice: sanitizeNumericText(e.target.value, true),
                      }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Adicional Casco Novo *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.50"
                    value={editForm.shellPrice}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setEditForm((f) => ({
                        ...f,
                        shellPrice: sanitizeNumericText(e.target.value, true),
                      }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Custo de Reposição *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.50"
                    value={editForm.costPrice}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, true)}
                    onChange={(e) => {
                      setEditForm((f) => ({
                        ...f,
                        costPrice: sanitizeNumericText(e.target.value, true),
                      }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Alerta Estoque Mínimo *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    value={editForm.minStock}
                    onKeyDown={(e) => preventNegativeNumberKeys(e, false)}
                    onChange={(e) => {
                      setEditForm((f) => ({
                        ...f,
                        minStock: sanitizeNumericText(e.target.value, false),
                      }));
                      setEditCylError(null);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditModalCyl(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cropSession && (
        <ImageCropperModal
          imageSrc={cropSession.src}
          onCancel={() => setCropSession(null)}
          onConfirm={handleCropConfirmed}
        />
      )}
    </div>
  );
}
