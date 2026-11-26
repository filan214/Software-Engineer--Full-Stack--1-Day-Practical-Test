/**
 * Formats an integer IDR amount as "Rp 1.234.567" deterministically across environments.
 */
export function formatIDR(amount: number): string {
  const rounded = Math.trunc(amount);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  const withDots = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}Rp ${withDots}`;
}

/**
 * Formats an ISO timestamp relative to `now` (e.g., "just now", "15m ago", "2h ago", "3d ago").
 */
export function formatRelativeTime(
  isoString: string | null,
  now: Date = new Date(),
): string {
  if (!isoString) {
    return 'Never';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Invalid date';
  }

  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSeconds < 60) {
    return 'just now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  }

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

export function formatDateTime(isoString: string | null): string {
  if (!isoString) {
    return '—';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
