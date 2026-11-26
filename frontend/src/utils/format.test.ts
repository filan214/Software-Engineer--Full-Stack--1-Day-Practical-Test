import { describe, expect, it } from 'vitest';
import { formatIDR, formatRelativeTime } from './format';

describe('formatIDR', () => {
  it('formats zero and positive integers with dot thousand separators', () => {
    expect(formatIDR(0)).toBe('Rp 0');
    expect(formatIDR(75000)).toBe('Rp 75.000');
    expect(formatIDR(1234567)).toBe('Rp 1.234.567');
    expect(formatIDR(181831000)).toBe('Rp 181.831.000');
  });

  it('formats negative integers safely', () => {
    expect(formatIDR(-50000)).toBe('-Rp 50.000');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-26T12:00:00Z');

  it('returns Never for null', () => {
    expect(formatRelativeTime(null, now)).toBe('Never');
  });

  it('formats seconds, minutes, hours, and days', () => {
    expect(formatRelativeTime('2026-11-26T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-11-26T11:45:00Z', now)).toBe('15m ago');
    expect(formatRelativeTime('2026-11-26T10:00:00Z', now)).toBe('2h ago');
    expect(formatRelativeTime('2026-11-23T12:00:00Z', now)).toBe('3d ago');
  });

  it('handles invalid timestamps gracefully', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('Invalid date');
  });
});
