/**
 * NetworkBadge — persistent chip showing the active Stellar network.
 *
 * Always visible in the popup header so users cannot accidentally sign on the
 * wrong network.  Uses distinct colours for mainnet vs test networks so the
 * distinction is impossible to miss.
 *
 * Issue #1032
 */

import type { NetworkMode } from '@/stores/settings';

interface NetworkBadgeProps {
  network: NetworkMode;
  /** Additional Tailwind classes for positioning / spacing overrides */
  className?: string;
}

const NETWORK_STYLES: Record<NetworkMode, { dot: string; badge: string; label: string }> = {
  mainnet: {
    dot: 'bg-green-400',
    badge: 'border-green-400/40 bg-green-400/15 text-green-300',
    label: 'Mainnet',
  },
  testnet: {
    dot: 'bg-yellow-400',
    badge: 'border-yellow-400/40 bg-yellow-400/15 text-yellow-300',
    label: 'Testnet',
  },
  futurenet: {
    dot: 'bg-purple-400',
    badge: 'border-purple-400/40 bg-purple-400/15 text-purple-300',
    label: 'Futurenet',
  },
};

export function NetworkBadge({ network, className = '' }: NetworkBadgeProps) {
  const styles = NETWORK_STYLES[network] ?? NETWORK_STYLES.testnet;

  return (
    <span
      aria-label={`Active network: ${styles.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${styles.badge} ${className}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${styles.dot} animate-pulse`} />
      {styles.label}
    </span>
  );
}
