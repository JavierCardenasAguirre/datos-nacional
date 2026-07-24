const WHITESPACE_REGEX = /\s+/g;

export function removeDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeText(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .trim()
    .replace(WHITESPACE_REGEX, ' ');
}

export function normalizeTextUpper(value: unknown): string {
  return removeDiacritics(normalizeText(value)).toUpperCase();
}

export function normalizeTipologia(value: unknown): string {
  const normalized = normalizeTextUpper(value);
  if (!normalized) return '';

  if (normalized === 'PROTESTA SOCIAL PACIFICA') {
    return 'PROTESTA SOCIAL PACIFICA';
  }

  if (normalized === 'PROTESTA SOCIAL VIOLENTA') {
    return 'PROTESTA SOCIAL VIOLENTA';
  }

  return normalized;
}

export function tipologiaVariantsForFilter(value: unknown): string[] {
  const normalized = normalizeTipologia(value);
  if (!normalized) return [];

  if (normalized === 'PROTESTA SOCIAL PACIFICA') {
    return ['PROTESTA SOCIAL PACIFICA', 'PROTESTA SOCIAL PACÍFICA'];
  }

  return [normalized];
}

export type TipologiaColor = {
  matcher: string;
  color: string;
};
