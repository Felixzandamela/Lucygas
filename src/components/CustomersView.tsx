import { Edit3, Plus, Search, ShoppingBag, Trash2, Users, Wallet, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { formatCurrency } from '../lib/formatters';
import {
  createCustomer,
  removeCustomer,
  settleCustomerCredit,
  updateCustomerProfile,
} from '../services/depotService';
import { type CurrencyCode, type Customer, FIELD_LIMITS, type MemberPermissions } from '../types/gas';

interface CustomersViewProps {
  uid: string;
  currency: CurrencyCode;
  customers: Customer[];
  permissions: MemberPermissions;
  onStartSaleForCustomer: (customerId: string) => void;
}

export function CustomersView({
  uid,
  currency,
  customers,
  permissions,
  onStartSaleForCustomer,
}: CustomersViewProps) {
  const [search, setSearch] = useState('');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    neighborhood: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const [creditTarget, setCreditTarget] = useState<Customer | null>(null);
  const [creditPayAmount, setCreditPayAmount] = useState<number>(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.neighborhood.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const openNewModal = () => {
    setEditingCustomer(null);
    setForm({ name: '', phone: '', address: '', neighborhood: '', notes: '' });
    setShowFormModal(true);
  };

  const openEditModal = (cust: Customer) => {
    setEditingCustomer(cust);
    setForm({
      name: cust.name,
      phone: cust.phone,
      address: cust.address,
      neighborhood: cust.neighborhood,
      notes: cust.notes,
    });
    setShowFormModal(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingCustomer) {
        await updateCustomerProfile(uid, editingCustomer.id, form);
      } else {
        await createCustomer(uid, form);
      }
      setShowFormModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handlePayCredit = async (e: FormEvent) => {
    e.preventDefault();
    if (!creditTarget || creditPayAmount <= 0) return;
    setSaving(true);
    try {
      await settleCustomerCredit(uid, creditTarget, creditPayAmount);
      setCreditTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cust: Customer) => {
    await removeCustomer(uid, cust.id);
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente por nome, telefone ou bairro..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
          />
        </div>

        {permissions.manageCustomers && (
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Cadastrar Cliente</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-14 text-center max-w-md mx-auto px-6">
            <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {customers.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Cadastre clientes recorrentes para agilizar entregas, endereço e controle de fiado.
            </p>
            {customers.length === 0 && permissions.manageCustomers && (
              <button
                type="button"
                onClick={openNewModal}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Cadastrar Primeiro Cliente</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Endereço / Bairro</th>
                  <th className="py-3 px-4 text-right">Pedidos</th>
                  <th className="py-3 px-4 text-right">Total Comprado</th>
                  <th className="py-3 px-4 text-right">Saldo Fiado</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filtered.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{cust.name}</div>
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {cust.phone || 'Sem telefone'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-slate-800 dark:text-slate-200 truncate max-w-[260px]">
                        {cust.address || '—'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {cust.neighborhood || ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {cust.totalOrders}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(cust.totalSpent, currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {cust.creditBalance > 0 ? (
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          {formatCurrency(cust.creditBalance, currency)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">Quitado</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {permissions.createSales && (
                          <button
                            type="button"
                            onClick={() => onStartSaleForCustomer(cust.id)}
                            className="px-2.5 py-1.5 rounded-md bg-orange-600 text-white text-xs font-medium hover:bg-orange-700 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>Vender</span>
                          </button>
                        )}
                        {permissions.manageCustomers && cust.creditBalance > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCreditTarget(cust);
                              setCreditPayAmount(cust.creditBalance);
                            }}
                            title="Receber pagamento de fiado"
                            className="px-2.5 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/50 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            <span>Receber</span>
                          </button>
                        )}
                        {permissions.manageCustomers && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(cust)}
                              title="Editar cliente"
                              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(cust)}
                              title="Excluir cliente"
                              className="p-1.5 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Customer Modal */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}
              </h3>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome *
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.CUSTOMER_NAME}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+258 874247787"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Endereço
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.ADDRESS}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Bairro / Região
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.NEIGHBORHOOD}
                  value={form.neighborhood}
                  onChange={(e) => setForm((f) => ({ ...f, neighborhood: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Observações
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.NOTES}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Ex.: Condomínio bloco B, prefere P13"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settle Credit Modal */}
      {creditTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Receber Fiado
              </h3>
              <button
                type="button"
                onClick={() => setCreditTarget(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Cliente: <strong className="text-slate-900 dark:text-slate-100">{creditTarget.name}</strong>
              <br />
              Saldo devedor atual:{' '}
              <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                {formatCurrency(creditTarget.creditBalance, currency)}
              </span>
            </p>
            <form onSubmit={handlePayCredit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Valor Recebido
                </label>
                <input
                  type="number"
                  min={0.01}
                  max={creditTarget.creditBalance}
                  step="0.50"
                  required
                  value={creditPayAmount}
                  onChange={(e) => setCreditPayAmount(Number(e.target.value) || 0)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreditTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Baixando...' : 'Confirmar Recebimento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
