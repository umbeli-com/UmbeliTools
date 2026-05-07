export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function formatPlaceholder(category: string, index: number, style: 'brackets' | 'curly'): string {
  const placeholder = `${category}_${index}`;
  return style === 'brackets' ? `[${placeholder}]` : `{${placeholder}}`;
}

export function sortByPosition<T extends { startIndex: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startIndex - b.startIndex);
}

function rangesOverlap(
  a: { startIndex: number; endIndex: number },
  b: { startIndex: number; endIndex: number },
): boolean {
  return a.startIndex < b.endIndex && b.startIndex < a.endIndex;
}

export function mergeRanges<T extends { startIndex: number; endIndex: number }>(items: T[]): T[] {
  if (items.length === 0) return [];
  const sorted = sortByPosition(items);
  const merged: T[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (rangesOverlap(last, current)) {
      if (current.endIndex - current.startIndex > last.endIndex - last.startIndex) {
        merged[merged.length - 1] = current;
      }
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function escapeRegexString(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
