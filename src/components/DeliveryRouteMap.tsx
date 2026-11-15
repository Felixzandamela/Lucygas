import { Check, Eye, MapPin, Navigation, Route, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { formatCurrency, getRecordMillis } from '../lib/formatters';
import { dispatchSalesRouteBatch } from '../services/depotService';
import { type CurrencyCode, type Customer, type DeliveryStatus, type Sale } from '../types/gas';
import { DeliveryStatusLabel } from './StatusLabel';

interface DeliveryRouteMapProps {
  uid: string;
  depotName: string;
  currency: CurrencyCode;
  sales: Sale[];
  customers: Customer[];
  drivers: string[];
  busyId: string | null;
  onStatusChange: (sale: Sale, nextStatus: DeliveryStatus, driverOverride?: string) => Promise<void>;
  onSelectSale: (sale: Sale) => void;
}

interface ZoneCluster {
  key: string;
  label: string;
  sales: Sale[];
  pendingSales: Sale[];
  inRouteSales: Sale[];
  deliveredSales: Sale[];
  totalUnits: number;
  totalValue: number;
  x: number;
  y: number;
  stops: {
    sale: Sale;
    stopIndex: number;
    x: number;
    y: number;
  }[];
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractZoneLabel(sale: Sale, customerMap: Map<string, Customer>): string {
  const customer = sale.customerId ? customerMap.get(sale.customerId) : undefined;
  if (customer?.neighborhood?.trim()) {
    return customer.neighborhood.trim();
  }

  const addr = (sale.deliveryAddress || '').trim();
  if (!addr) return 'Sem Bairro Definido';

  // PosView concatenates "[address, neighborhood].join(' - ')"
  if (addr.includes(' - ')) {
    const parts = addr
      .split(' - ')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const candidate = parts[parts.length - 1];
      if (candidate.length >= 2 && candidate.length <= 48) {
        return candidate;
      }
    }
  }

  const bairroMatch = addr.match(/\bbairro\s+([^,\-]+)/i);
  if (bairroMatch?.[1]) {
    return bairroMatch[1].trim();
  }

  if (addr.includes(',')) {
    const parts = addr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      return parts[parts.length - 1];
    }
    if (parts.length >= 1) {
      return parts[0].slice(0, 32);
    }
  }

  return addr.slice(0, 32);
}

function streetSortKey(address: string): string {
  return normalizeKey(address).replace(/\d+/g, '').trim();
}

export function DeliveryRouteMap({
  uid,
  depotName,
  currency,
  sales,
  customers,
  drivers,
  busyId,
  onStatusChange,
  onSelectSale,
}: DeliveryRouteMapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [mapScope, setMapScope] = useState<'active' | 'all'>('active');
  const [selectedZoneKey, setSelectedZoneKey] = useState<string | null>(null);
  const [batchDriver, setBatchDriver] = useState<string>(drivers[0] ?? '');
  const [dispatchingZone, setDispatchingZone] = useState(false);

  useEffect(() => {
    if (!batchDriver && drivers.length > 0) {
      setBatchDriver(drivers[0]);
    }
  }, [drivers, batchDriver]);

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  const deliverySales = useMemo(() => {
    return sales.filter((s) => {
      if (s.fulfillmentType !== 'delivery') return false;
      if (s.deliveryStatus === 'cancelled') return false;
      if (mapScope === 'active') {
        return s.deliveryStatus === 'pending' || s.deliveryStatus === 'in_route';
      }
      return true;
    });
  }, [sales, mapScope]);

  const zones: ZoneCluster[] = useMemo(() => {
    const buckets = new Map<string, { label: string; sales: Sale[] }>();

    for (const sale of deliverySales) {
      const label = extractZoneLabel(sale, customerMap);
      const key = normalizeKey(label) || 'geral';
      const existing = buckets.get(key);
      if (existing) {
        existing.sales.push(sale);
      } else {
        buckets.set(key, { label, sales: [sale] });
      }
    }

    // Sort zones by pending + in_route volume descending so priority routes are prominent
    const orderedBuckets = Array.from(buckets.entries()).sort((a, b) => {
      const aActive = a[1].sales.filter((s) => s.deliveryStatus !== 'delivered').length;
      const bActive = b[1].sales.filter((s) => s.deliveryStatus !== 'delivered').length;
      if (bActive !== aActive) return bActive - aActive;
      return b[1].sales.length - a[1].sales.length;
    });

    const centerX = 400;
    const centerY = 230;
    const total = orderedBuckets.length;

    return orderedBuckets.map(([key, bucket], idx) => {
      // Optimize stop order within the zone: in_route first, then group by street, then oldest first
      const statusWeight: Record<DeliveryStatus, number> = {
        in_route: 0,
        pending: 1,
        delivered: 2,
        cancelled: 3,
      };
      const sortedSales = [...bucket.sales].sort((a, b) => {
        const sw = statusWeight[a.deliveryStatus] - statusWeight[b.deliveryStatus];
        if (sw !== 0) return sw;
        const streetCmp = streetSortKey(a.deliveryAddress).localeCompare(
          streetSortKey(b.deliveryAddress)
        );
        if (streetCmp !== 0) return streetCmp;
        return getRecordMillis(a) - getRecordMillis(b);
      });

      const angle = (idx / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
      const radiusX = total === 1 ? 190 : idx % 2 === 0 ? 270 : 215;
      const radiusY = total === 1 ? 0 : idx % 2 === 0 ? 155 : 120;
      const zx = Math.round(centerX + Math.cos(angle) * radiusX);
      const zy = Math.round(centerY + Math.sin(angle) * radiusY);

      const stops = sortedSales.map((sale, sIdx) => {
        if (sortedSales.length === 1) {
          return { sale, stopIndex: 1, x: zx, y: zy };
        }
        const subAngle = (sIdx / sortedSales.length) * Math.PI * 2;
        const subRadius = Math.min(34, 16 + sortedSales.length * 3);
        return {
          sale,
          stopIndex: sIdx + 1,
          x: Math.round(zx + Math.cos(subAngle) * subRadius),
          y: Math.round(zy + Math.sin(subAngle) * subRadius),
        };
      });

      return {
        key,
        label: bucket.label,
        sales: sortedSales,
        pendingSales: sortedSales.filter((s) => s.deliveryStatus === 'pending'),
        inRouteSales: sortedSales.filter((s) => s.deliveryStatus === 'in_route'),
        deliveredSales: sortedSales.filter((s) => s.deliveryStatus === 'delivered'),
        totalUnits: sortedSales.reduce((acc, s) => acc + s.quantity, 0),
        totalValue: sortedSales.reduce((acc, s) => acc + s.totalAmount, 0),
        x: zx,
        y: zy,
        stops,
      };
    });
  }, [deliverySales, customerMap]);

  useEffect(() => {
    if (zones.length === 0) {
      setSelectedZoneKey(null);
      return;
    }
    if (!selectedZoneKey || !zones.some((z) => z.key === selectedZoneKey)) {
      setSelectedZoneKey(zones[0].key);
    }
  }, [zones, selectedZoneKey]);

  const activeZone = zones.find((z) => z.key === selectedZoneKey) ?? zones[0] ?? null;

  const handleDispatchZone = async (zone: ZoneCluster) => {
    if (zone.pendingSales.length === 0) return;
    setDispatchingZone(true);
    try {
      await dispatchSalesRouteBatch(uid, zone.pendingSales, batchDriver);
    } finally {
      setDispatchingZone(false);
    }
  };

  const totalUnits = deliverySales.reduce((acc, s) => acc + s.quantity, 0);

  return (
    <div className="space-y-4">
      {deliverySales.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-14 px-6 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <p className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {mapScope === 'active'
                ? 'Nenhuma entrega pendente ou em rota para mapear'
                : 'Nenhuma entrega encontrada neste período'}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Pedidos de delivery aparecerão agrupados por bairro e rua para otimizar suas rotas.
            </p>
          </div>
          {mapScope === 'active' && (
            <button
              type="button"
              onClick={() => setMapScope('all')}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Mostrar entregas já concluídas
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Simplified Spatial Route Map */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Route className="w-4 h-4 text-orange-600 dark:text-orange-500" />
                  <span>Mapa Simplificado de Zonas e Rotas</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  {zones.length} região(ões) · {deliverySales.length} entregas · {totalUnits} botijões
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMapScope('active')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                    mapScope === 'active'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Ativas
                </button>
                <button
                  type="button"
                  onClick={() => setMapScope('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                    mapScope === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Todas
                </button>
              </div>
            </div>

            <div className="bg-slate-50/70 dark:bg-slate-950/60 p-3 sm:p-4">
              <svg
                viewBox="0 0 800 460"
                className="w-full h-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 select-none"
                role="img"
                aria-label="Mapa simplificado de agrupamento de entregas por bairro e endereço"
              >
                {/* Background Street Grid */}
                <defs>
                  <pattern id="route-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path
                      d="M 40 0 L 0 0 0 40"
                      fill="none"
                      stroke={isDark ? '#1e293b' : '#f1f5f9'}
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect width="800" height="460" fill="url(#route-grid)" />

                {/* Concentric distance rings from Depot */}
                <circle
                  cx="400"
                  cy="230"
                  r="115"
                  fill="none"
                  stroke={isDark ? '#334155' : '#e2e8f0'}
                  strokeDasharray="4 4"
                />
                <circle
                  cx="400"
                  cy="230"
                  r="230"
                  fill="none"
                  stroke={isDark ? '#334155' : '#e2e8f0'}
                  strokeDasharray="4 4"
                />

                {/* Route Connections from Depot to Zones */}
                {zones.map((zone) => {
                  const isSelected = activeZone?.key === zone.key;
                  const hasInRoute = zone.inRouteSales.length > 0;
                  const allDelivered =
                    zone.pendingSales.length === 0 && zone.inRouteSales.length === 0;
                  const strokeColor = allDelivered
                    ? '#10b981'
                    : hasInRoute
                      ? '#ea580c'
                      : isSelected
                        ? isDark
                          ? '#f8fafc'
                          : '#0f172a'
                        : isDark
                          ? '#64748b'
                          : '#94a3b8';

                  return (
                    <g key={`link-${zone.key}`}>
                      <line
                        x1="400"
                        y1="230"
                        x2={zone.x}
                        y2={zone.y}
                        stroke={strokeColor}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeDasharray={zone.pendingSales.length > 0 && !hasInRoute ? '6 4' : undefined}
                        opacity={isSelected ? 0.95 : 0.55}
                      />
                    </g>
                  );
                })}

                {/* Depot Center Origin */}
                <g transform="translate(400, 230)">
                  <circle
                    r="24"
                    fill={isDark ? '#f97316' : '#0f172a'}
                    stroke={isDark ? '#020617' : '#ffffff'}
                    strokeWidth="3"
                  />
                  <text
                    textAnchor="middle"
                    y="4"
                    fill="#ffffff"
                    fontSize="10"
                    fontWeight="700"
                    fontFamily="sans-serif"
                  >
                    BASE
                  </text>
                  <text
                    textAnchor="middle"
                    y="39"
                    fill={isDark ? '#cbd5e1' : '#334155'}
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="sans-serif"
                  >
                    {depotName.slice(0, 22)}
                  </text>
                </g>

                {/* Zone Clusters and Individual Stop Pins */}
                {zones.map((zone) => {
                  const isSelected = activeZone?.key === zone.key;
                  const clusterRadius = Math.min(54, 34 + zone.sales.length * 4);
                  const hasPending = zone.pendingSales.length > 0;
                  const hasInRoute = zone.inRouteSales.length > 0;

                  return (
                    <g
                      key={zone.key}
                      onClick={() => setSelectedZoneKey(zone.key)}
                      className="cursor-pointer"
                    >
                      {/* Cluster Halo */}
                      <circle
                        cx={zone.x}
                        cy={zone.y}
                        r={clusterRadius}
                        fill={
                          isSelected
                            ? isDark
                              ? '#431407'
                              : '#fff7ed'
                            : isDark
                              ? '#0f172a'
                              : '#f8fafc'
                        }
                        stroke={
                          isSelected
                            ? '#ea580c'
                            : hasInRoute
                              ? isDark
                                ? '#fb923c'
                                : '#fdba74'
                              : hasPending
                                ? isDark
                                  ? '#475569'
                                  : '#cbd5e1'
                                : isDark
                                  ? '#059669'
                                  : '#a7f3d0'
                        }
                        strokeWidth={isSelected ? 2 : 1.25}
                      />

                      {/* Route path connecting stops inside zone */}
                      {zone.stops.length > 1 && (
                        <polyline
                          points={zone.stops.map((st) => `${st.x},${st.y}`).join(' ')}
                          fill="none"
                          stroke={isDark ? '#64748b' : '#94a3b8'}
                          strokeWidth="1.25"
                          strokeDasharray="3 3"
                        />
                      )}

                      {/* Stop pins */}
                      {zone.stops.map((st) => {
                        const pinColor =
                          st.sale.deliveryStatus === 'delivered'
                            ? '#059669'
                            : st.sale.deliveryStatus === 'in_route'
                              ? '#ea580c'
                              : isDark
                                ? '#475569'
                                : '#0f172a';
                        return (
                          <g
                            key={st.sale.id}
                            transform={`translate(${st.x}, ${st.y})`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedZoneKey(zone.key);
                            }}
                          >
                            <circle
                              r="11"
                              fill={pinColor}
                              stroke={isDark ? '#020617' : '#ffffff'}
                              strokeWidth="2"
                            />
                            <text
                              textAnchor="middle"
                              y="3.5"
                              fill="#ffffff"
                              fontSize="9.5"
                              fontWeight="700"
                              fontFamily="monospace"
                            >
                              {st.stopIndex}
                            </text>
                          </g>
                        );
                      })}

                      {/* Zone Label & Load Summary */}
                      <g transform={`translate(${zone.x}, ${zone.y + clusterRadius + 15})`}>
                        <rect
                          x="-66"
                          y="-11"
                          width="132"
                          height="22"
                          rx="4"
                          fill={
                            isSelected
                              ? isDark
                                ? '#ea580c'
                                : '#0f172a'
                              : isDark
                                ? '#0f172a'
                                : '#ffffff'
                          }
                          stroke={
                            isSelected
                              ? isDark
                                ? '#ea580c'
                                : '#0f172a'
                              : isDark
                                ? '#334155'
                                : '#cbd5e1'
                          }
                          strokeWidth="1"
                        />
                        <text
                          textAnchor="middle"
                          y="3.5"
                          fill={isSelected ? '#ffffff' : isDark ? '#f1f5f9' : '#0f172a'}
                          fontSize="10.5"
                          fontWeight="600"
                          fontFamily="sans-serif"
                        >
                          {zone.label.length > 15
                            ? `${zone.label.slice(0, 14)}…`
                            : zone.label}{' '}
                          ({zone.sales.length})
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>

              {/* Map Legend */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400 px-1">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-900 dark:bg-slate-500" />
                    <span>Pendente</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-600" />
                    <span>Em Rota</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                    <span>Entregue</span>
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Clique em uma região para ver as paradas agrupadas
                </span>
              </div>
            </div>
          </div>

          {/* Right: Zone Cluster Selector & Optimized Stop List */}
          <div className="lg:col-span-5 space-y-4">
            {/* Quick Zone Tabs */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Regiões Agrupadas por Proximidade ({zones.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {zones.map((zone) => {
                  const selected = activeZone?.key === zone.key;
                  return (
                    <button
                      key={zone.key}
                      type="button"
                      onClick={() => setSelectedZoneKey(zone.key)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-orange-600 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-950 dark:text-orange-200 font-semibold'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {zone.label} ·{' '}
                      <span className="font-mono tabular-nums">{zone.sales.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {activeZone && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Navigation className="w-4 h-4 text-orange-600 dark:text-orange-500 shrink-0" />
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          Rota: {activeZone.label}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
                        {activeZone.sales.length} paradas · {activeZone.totalUnits} botijões ·{' '}
                        {formatCurrency(activeZone.totalValue, currency)}
                      </p>
                    </div>
                  </div>

                  {/* Batch Dispatch Bar for Pending Orders in Zone */}
                  {activeZone.pendingSales.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Selecionar entregador para o grupo"
                        value={batchDriver}
                        onChange={(e) => setBatchDriver(e.target.value)}
                        className="h-9 flex-1 min-w-[140px] px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-orange-600"
                      >
                        <option value="">Manter entregador atual</option>
                        {drivers.map((drv) => (
                          <option key={drv} value={drv}>
                            {drv}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={dispatchingZone}
                        onClick={() => void handleDispatchZone(activeZone)}
                        className="h-9 px-3.5 rounded-md bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <Truck className="w-3.5 h-3.5 text-orange-400 dark:text-orange-100" />
                        <span>
                          {dispatchingZone
                            ? 'Despachando...'
                            : `Despachar Grupo (${activeZone.pendingSales.length})`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Ordered Stop Sequence */}
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[380px] overflow-y-auto">
                  {activeZone.stops.map(({ sale, stopIndex }) => (
                    <div key={sale.id} className="p-4 space-y-2.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span
                            className={`w-6 h-6 rounded-full text-[11px] font-mono font-bold text-white flex items-center justify-center shrink-0 mt-0.5 ${
                              sale.deliveryStatus === 'delivered'
                                ? 'bg-emerald-600'
                                : sale.deliveryStatus === 'in_route'
                                  ? 'bg-orange-600'
                                  : 'bg-slate-900 dark:bg-slate-600'
                            }`}
                          >
                            {stopIndex}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                                {sale.customerName}
                              </span>
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                                {sale.orderNumber}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                              {sale.deliveryAddress || 'Endereço não informado'}
                            </p>
                          </div>
                        </div>
                        <DeliveryStatusLabel status={sale.deliveryStatus} />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pl-8">
                        <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {sale.quantity}x {sale.cylinderCode}
                          </span>
                          {' · '}
                          <span>{formatCurrency(sale.totalAmount, currency)}</span>
                          {sale.driverName ? ` · ${sale.driverName}` : ''}
                        </div>

                        <div className="inline-flex items-center gap-1.5">
                          {sale.deliveryStatus === 'pending' && (
                            <button
                              type="button"
                              disabled={busyId === sale.id}
                              onClick={() => void onStatusChange(sale, 'in_route')}
                              className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Truck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                              <span>Despachar</span>
                            </button>
                          )}
                          {sale.deliveryStatus === 'in_route' && (
                            <button
                              type="button"
                              disabled={busyId === sale.id}
                              onClick={() => void onStatusChange(sale, 'delivered')}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>Entregar</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectSale(sale)}
                            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="Ver detalhes"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
