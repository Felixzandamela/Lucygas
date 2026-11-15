import type { Timestamp } from 'firebase/firestore';
import type { CurrencyCode } from '../types/gas';

export function formatCurrency(value: number, currency: CurrencyCode = 'BRL'): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (currency === 'MZN') {
    return `${safe.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`;
  }
  if (currency === 'EUR') {
    return safe.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  }
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDateTime(ts?: Timestamp | null): string {
  if (!ts) return 'Agora';
  const date = ts.toDate();
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getRecordTimestamp(record: {
  occurredAt?: Timestamp | null;
  createdAt?: Timestamp | null;
}): Timestamp | null | undefined {
  return record.occurredAt ?? record.createdAt;
}

export function getRecordDate(record: {
  occurredAt?: Timestamp | null;
  createdAt?: Timestamp | null;
}): Date {
  return (record.occurredAt ?? record.createdAt)?.toDate() ?? new Date();
}

export function getRecordMillis(record: {
  occurredAt?: Timestamp | null;
  createdAt?: Timestamp | null;
}): number {
  return (record.occurredAt ?? record.createdAt)?.toMillis() ?? Date.now();
}

export function formatShortDate(ts?: Timestamp | null): string {
  if (!ts) return 'Hoje';
  return ts.toDate().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

export function sanitizeText(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function generateOrderNumber(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const rand = String(Math.floor(100 + Math.random() * 900));
  return `PED-${hh}${mm}-${rand}`;
}

export function clampNonNegative(value: number, max = 100000000): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value * 100) / 100));
}
