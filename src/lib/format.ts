export function parseGeos(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function moneyInputToCents(raw: FormDataEntryValue | null): number {
  const text = String(raw ?? '').replace(/[\s ]/g, '').replace(',', '.');
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export const OFFER_STATUS: Record<string, { label: string; color: string; tint: string }> = {
  ACTIVE: { label: 'Активен', color: '#b4c68c', tint: '#252e1e' },
  TEST: { label: 'Тест', color: '#e4e4e4', tint: '#2e2e2f' },
  PAUSED: { label: 'Пауза', color: '#ce6e58', tint: '#2c1f1a' },
  DEAD: { label: 'Умер', color: '#8a8a8a', tint: '#232324' },
};
