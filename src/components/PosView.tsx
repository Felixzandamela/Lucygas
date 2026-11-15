import { CheckCircle2, Minus, Plus, Printer, Search, Store, Truck, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import cylinderStudioImg from '../assets/images/gas_cylinder_studio_1794631289411.jpg';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatCurrency } from '../lib/formatters';
import { createCustomer, createSaleTransaction } from '../services/depotService';
import {
  type AppSection,
  type CurrencyCode,
  type Customer,
  type Cylinder,
  type Depot,
  FIELD_LIMITS,
  type FulfillmentType,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type Sale,
  type SaleMode,
  SELECTABLE_PAYMENT_METHODS,
} from '../types/gas';
import { ReceiptModal } from './ReceiptModal';

interface PosViewProps {
  uid: string;
  depot: Depot | null;
  currency: CurrencyCode;
  cylinders: Cylinder[];
  customers: Customer[];
  preselectedCustomerId?: string | null;
  onClearPreselectedCustomer?: () => void;
  onNavigate: (section: AppSection) => void;
}

export function PosView({
  uid,
  depot,
  currency,
  cylinders,
  customers,
  preselectedCustomerId,
  onClearPreselectedCustomer,
  onNavigate,
}: PosViewProps) {
  const isOnline = useOnlineStatus();
  const [selectedCylinderId, setSelectedCylinderId] = useState<string>('');
  const [saleMode, setSaleMode] = useState<SaleMode>('exchange');
  const [quantity, setQuantity] = useState<number>(1);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('pickup');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerQuery, setCustomerQuery] = useState<string>('');
  const [walkInName, setWalkInName] = useState<string>('Cliente Balcão');
  const [walkInPhone, setWalkInPhone] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [driverName, setDriverName] = useState<string>('');
  const [deliveryFee, setDeliveryFee] = useState<number>(depot?.deliveryFee ?? 0);
  const [discount, setDiscount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [failedImgSrc, setFailedImgSrc] = useState<string | null>(null);

  // Quick customer modal
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustNeighborhood, setNewCustNeighborhood] = useState('');
  const [creatingCust, setCreatingCust] = useState(false);

  useEffect(() => {
    if (!selectedCylinderId && cylinders.length > 0) {
      const p13 = cylinders.find((c) => c.code === 'P13') ?? cylinders[0];
      setSelectedCylinderId(p13.id);
    }
  }, [cylinders, selectedCylinderId]);

  useEffect(() => {
    if (depot) {
      setDeliveryFee(depot.deliveryFee);
      if (!driverName && depot.drivers.length > 0) {
        setDriverName(depot.drivers[0]);
      }
    }
  }, [depot, driverName]);

  useEffect(() => {
    if (preselectedCustomerId) {
      const found = customers.find((c) => c.id === preselectedCustomerId);
      if (found) {
        setSelectedCustomerId(found.id);
        setDeliveryAddress(
          [found.address, found.neighborhood].filter(Boolean).join(' - ')
        );
      }
      onClearPreselectedCustomer?.();
    }
  }, [preselectedCustomerId, customers, onClearPreselectedCustomer]);

  const selectedCylinder = useMemo(
    () => cylinders.find((c) => c.id === selectedCylinderId) ?? null,
    [cylinders, selectedCylinderId]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 6);
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.neighborhood.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [customers, customerQuery]);

  const unitPrice = selectedCylinder
    ? saleMode === 'exchange'
      ? selectedCylinder.salePrice
      : selectedCylinder.salePrice + selectedCylinder.shellPrice
    : 0;

  const subtotal = unitPrice * quantity;
  const activeDeliveryFee = fulfillmentType === 'delivery' ? deliveryFee : 0;
  const finalTotal = Math.max(0, subtotal + activeDeliveryFee - discount);

  const handleSelectCustomer = (customer: Customer | null) => {
    if (!customer) {
      setSelectedCustomerId('');
      setDeliveryAddress('');
      return;
    }
    setSelectedCustomerId(customer.id);
    setDeliveryAddress([customer.address, customer.neighborhood].filter(Boolean).join(' - '));
  };

  const handleCreateQuickCustomer = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    setCreatingCust(true);
    try {
      const newId = await createCustomer(uid, {
        name: newCustName,
        phone: newCustPhone,
        address: newCustAddress,
        neighborhood: newCustNeighborhood,
        notes: '',
      });
      setSelectedCustomerId(newId);
      setDeliveryAddress([newCustAddress, newCustNeighborhood].filter(Boolean).join(' - '));
      setShowNewCustomerModal(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
      setNewCustNeighborhood('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar cliente.');
    } finally {
      setCreatingCust(false);
    }
  };

  const handleSubmitOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCylinder) return;
    setErrorMsg(null);
    setLastSale(null);

    if (selectedCylinder.fullCount < quantity) {
      setErrorMsg(
        `Estoque insuficiente de ${selectedCylinder.code}. Disponível: ${selectedCylinder.fullCount} unidades.`
      );
      return;
    }

    if (fulfillmentType === 'delivery' && !deliveryAddress.trim()) {
      setErrorMsg('Informe o endereço de entrega ou altere para Retirada no Balcão.');
      return;
    }

    setSubmitting(true);
    try {
      const createdSale = await createSaleTransaction({
        uid,
        cylinder: selectedCylinder,
        customer: selectedCustomer,
        walkInName,
        walkInPhone,
        deliveryAddress,
        saleMode,
        quantity,
        discount,
        deliveryFee: activeDeliveryFee,
        fulfillmentType,
        driverName,
        paymentMethod,
        notes,
      });
      setLastSale(createdSale);
      setReceiptSale(createdSale);
      setQuantity(1);
      setDiscount(0);
      setNotes('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao registrar venda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {lastSale && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                {isOnline
                  ? `Venda ${lastSale.orderNumber} registrada e estoque atualizado`
                  : `Venda ${lastSale.orderNumber} salva offline e estoque atualizado`}
              </p>
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                {isOnline
                  ? 'O pedido já está disponível no painel de entregas e fluxo de caixa.'
                  : 'Salvo no dispositivo. A sincronização com a nuvem ocorrerá automaticamente ao reconectar.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReceiptSale(lastSale)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-200 text-xs font-semibold hover:bg-emerald-100/70 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir Recibo</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-700 dark:bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-800 dark:hover:bg-emerald-500 whitespace-nowrap cursor-pointer"
            >
              Ver Vendas e Entregas
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl p-4 text-sm text-red-800 dark:text-red-200 font-medium">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Builder */}
        <div className="lg:col-span-8 space-y-6">
          {/* 1. Product Selection */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  1. Escolha o Botijão e Modalidade
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Selecione o tipo de gás e se o cliente entrega casco vazio
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSaleMode('exchange')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    saleMode === 'exchange'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Troca de Casco
                </button>
                <button
                  type="button"
                  onClick={() => setSaleMode('full_with_shell')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    saleMode === 'full_with_shell'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Botijão + Casco Novo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cylinders.map((cyl) => {
                const isSelected = cyl.id === selectedCylinderId;
                const price =
                  saleMode === 'exchange' ? cyl.salePrice : cyl.salePrice + cyl.shellPrice;
                const outOfStock = cyl.fullCount === 0;
                return (
                  <button
                    key={cyl.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => {
                      setSelectedCylinderId(cyl.id);
                      if (quantity > cyl.fullCount) setQuantity(Math.max(1, cyl.fullCount));
                    }}
                    className={`text-left p-4 rounded-xl border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isSelected
                        ? 'border-orange-600 dark:border-orange-500 bg-orange-50/40 dark:bg-orange-950/30 ring-1 ring-orange-600 dark:ring-orange-500'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden shrink-0">
                        <img
                          src={cyl.imageUrl || cylinderStudioImg}
                          alt={cyl.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                              {cyl.code}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{cyl.weightKg} kg</span>
                          </div>
                          <span className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {formatCurrency(price, currency)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 truncate">{cyl.name}</p>
                      </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>Cheios: {cyl.fullCount}</span>
                      <span>Vazios: {cyl.emptyCount}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Quantity & Discount */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Quantidade
                </label>
                <div className="inline-flex items-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-l-lg cursor-pointer"
                    aria-label="Diminuir quantidade"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={selectedCylinder?.fullCount || 500}
                    value={quantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setQuantity(Number.isNaN(val) ? 1 : Math.max(1, val));
                    }}
                    className="w-16 text-center font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100 bg-transparent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setQuantity((q) =>
                        Math.min(selectedCylinder?.fullCount || 500, q + 1)
                      )
                    }
                    className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-r-lg cursor-pointer"
                    aria-label="Aumentar quantidade"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Desconto ({currency})
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.50"
                  value={discount}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
            </div>
          </div>

          {/* 2. Customer & Delivery */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  2. Cliente e Forma de Entrega
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Vincule um cliente cadastrado ou faça venda rápida de balcão
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewCustomerModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Novo Cliente</span>
              </button>
            </div>

            {/* Fulfillment Segmented Control */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFulfillmentType('pickup')}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                  fulfillmentType === 'pickup'
                    ? 'border-slate-900 dark:border-orange-600 bg-slate-900 dark:bg-orange-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Store className="w-4 h-4 shrink-0" />
                <span>Retirada no Balcão</span>
              </button>
              <button
                type="button"
                onClick={() => setFulfillmentType('delivery')}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                  fulfillmentType === 'delivery'
                    ? 'border-slate-900 dark:border-orange-600 bg-slate-900 dark:bg-orange-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Truck className="w-4 h-4 shrink-0" />
                <span>Entrega (Delivery)</span>
              </button>
            </div>

            {/* Customer picker */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Buscar cliente por nome, telefone ou bairro..."
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectCustomer(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    !selectedCustomerId
                      ? 'border-orange-600 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  Cliente Avulso / Balcão
                </button>
                {filteredCustomers.map((cust) => (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => handleSelectCustomer(cust)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      selectedCustomerId === cust.id
                        ? 'border-orange-600 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {cust.name}
                    {cust.neighborhood ? ` · ${cust.neighborhood}` : ''}
                  </button>
                ))}
              </div>
            </div>

            {!selectedCustomer && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nome do Cliente
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.CUSTOMER_NAME}
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    required
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.PHONE}
                    value={walkInPhone}
                    onChange={(e) => setWalkInPhone(e.target.value)}
                    placeholder="+258 874247787"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>
            )}

            {fulfillmentType === 'delivery' && (
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="sm:col-span-6">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Endereço de Entrega
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.ADDRESS}
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Rua, número, complemento e bairro"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Entregador
                  </label>
                  <select
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-orange-600"
                  >
                    <option value="">A definir</option>
                    {(depot?.drivers || []).map((drv) => (
                      <option key={drv} value={drv}>
                        {drv}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Taxa de Entrega
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.50"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 3. Payment & Notes */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              3. Forma de Pagamento e Observações
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {SELECTABLE_PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    paymentMethod === method
                      ? 'border-orange-600 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200 font-semibold'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Observações do Pedido (opcional)
              </label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.NOTES}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: Troco / Portão azul / Entregar após 14h"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Live Order Receipt */}
        <aside className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 lg:sticky lg:top-20">
          <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
              {(() => {
                const activeSrc = selectedCylinder?.imageUrl || cylinderStudioImg;
                if (failedImgSrc === activeSrc) {
                  return (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-400">
                      {selectedCylinder?.code || 'GLP'}
                    </div>
                  );
                }
                return (
                  <img
                    src={activeSrc}
                    alt={selectedCylinder?.name || 'Botijão de gás GLP'}
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImgSrc(activeSrc)}
                    className="w-full h-full object-cover"
                  />
                );
              })()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Resumo do Pedido</p>
              <p className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {selectedCylinder ? `${quantity}x ${selectedCylinder.code}` : 'Selecione um item'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {saleMode === 'exchange' ? 'Recarga com troca de casco' : 'Botijão completo (com casco)'}
              </p>
            </div>
          </div>

          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-600 dark:text-slate-400">Cliente</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                {selectedCustomer ? selectedCustomer.name : walkInName || 'Cliente Balcão'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-600 dark:text-slate-400">Atendimento</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {fulfillmentType === 'delivery' ? 'Entrega' : 'Retirada no Balcão'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-600 dark:text-slate-400">Pagamento</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {PAYMENT_METHOD_LABELS[paymentMethod]}
              </dd>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <dt className="text-slate-600 dark:text-slate-400">Subtotal ({quantity}x)</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(subtotal, currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-600 dark:text-slate-400">Taxa de entrega</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(activeDeliveryFee, currency)}
              </dd>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                <dt>Desconto</dt>
                <dd className="font-mono tabular-nums">- {formatCurrency(discount, currency)}</dd>
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex items-baseline justify-between">
              <dt className="font-display font-semibold text-slate-900 dark:text-slate-100">Total a Cobrar</dt>
              <dd className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
                {formatCurrency(finalTotal, currency)}
              </dd>
            </div>
          </dl>

          {selectedCylinder && (
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono tabular-nums">
              <div className="flex justify-between">
                <span>Cheios após venda:</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {selectedCylinder.fullCount} → {Math.max(0, selectedCylinder.fullCount - quantity)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Cascos vazios após venda:</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {selectedCylinder.emptyCount} →{' '}
                  {selectedCylinder.emptyCount + (saleMode === 'exchange' ? quantity : 0)}
                </span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedCylinder || selectedCylinder.fullCount < quantity}
            className="w-full py-3 px-4 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {submitting ? 'Registrando venda...' : 'Finalizar Venda'}
          </button>
        </aside>
      </form>

      {/* Quick Customer Modal */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Cadastro Rápido de Cliente
              </h3>
              <button
                type="button"
                onClick={() => setShowNewCustomerModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateQuickCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.CUSTOMER_NAME}
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.PHONE}
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="+258 874247787"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Endereço</label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.ADDRESS}
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Bairro</label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.NEIGHBORHOOD}
                  value={newCustNeighborhood}
                  onChange={(e) => setNewCustNeighborhood(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewCustomerModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingCust}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  {creatingCust ? 'Salvando...' : 'Salvar e Selecionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiptSale && (
        <ReceiptModal
          sale={receiptSale}
          depotName={depot?.name || 'Distribuidora de Gás'}
          currency={currency}
          onClose={() => setReceiptSale(null)}
        />
      )}
    </div>
  );
}
