/**
 * Unit tests for handleGetPublicKey, handleGetNetwork, and handleGetSmartAccount (#809, #960)
 */

import { handleGetPublicKey, handleGetNetwork, handleRequestAccess, handleGetSmartAccount } from '../handlers';
import type { ExternalHandlerContext } from '@ancore/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = 'CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

const localStore: Record<string, unknown> = {};

const mockLocalStorage = {
  get: vi.fn((key: string, cb: (result: Record<string, unknown>) => void) => {
    cb({ [key]: localStore[key] ?? null });
  }),
  set: vi.fn((data: Record<string, unknown>, cb?: () => void) => {
    Object.assign(localStore, data);
    cb?.();
  }),
};

vi.mock('@/stores/settings', () => ({
  getSettingsState: () => ({ network: 'testnet' }),
}));

vi.mock('../allowlist', () => ({
  isAllowed: vi.fn().mockResolvedValue(true),
  addToAllowlist: vi.fn(),
}));

vi.mock('../response-queue', () => ({
  enqueueApproval: vi.fn(),
  registerResponseCallbacks: vi.fn(),
}));

vi.mock('../../../approval-window', () => ({
  openApprovalWindow: vi.fn().mockResolvedValue(undefined),
}));

// ── handleGetSmartAccount mocks ───────────────────────────────────────────────

let mockGetOwner: ReturnType<typeof vi.fn>;

vi.mock('@ancore/account-abstraction', () => ({
  AccountContract: vi.fn().mockImplementation(() => ({
    getOwner: (...args: unknown[]) => mockGetOwner(...args),
  })),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getAccount: vi.fn().mockResolvedValue({ accountId: () => 'GAAA', sequenceNumber: () => '0' }),
      simulateTransaction: vi.fn(),
    })),
  },
}));

// Re-set globalThis.chrome in beforeEach because vitest.setup.ts deletes it
// before every test to prevent leakage between files.
beforeEach(() => {
  (globalThis as any).chrome = { storage: { local: mockLocalStorage } };
  Object.keys(localStore).forEach((k) => delete localStore[k]);
  // Clears recorded calls on every mock (implementations are preserved) so
  // assertions like `not.toHaveBeenCalled()` don't see calls from prior tests.
  vi.clearAllMocks();
  mockGetOwner = vi.fn();
});

function makeCtx(
  origin = 'https://dapp.example',
  params: Record<string, unknown> = {}
): ExternalHandlerContext {
  return {
    origin,
    params,
    requestId: 'test-req-id',
    sender: {},
  };
}

// ── handleGetPublicKey ────────────────────────────────────────────────────────

describe('handleGetPublicKey', () => {
  it('returns the stored contract address as publicKey', async () => {
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;

    const result = await handleGetPublicKey(makeCtx());
    expect(result.publicKey).toBe(CONTRACT_ADDRESS);
  });

  it('throws when wallet is not onboarded (no stored address)', async () => {
    await expect(handleGetPublicKey(makeCtx())).rejects.toThrow('Wallet not set up');
  });

  it('throws when origin is not in the allowlist', async () => {
    const { isAllowed } = await import('../allowlist');
    vi.mocked(isAllowed).mockResolvedValueOnce(false);
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;

    await expect(handleGetPublicKey(makeCtx('https://untrusted.example'))).rejects.toThrow(
      'Origin not allowed'
    );
  });
});

// ── handleGetNetwork ──────────────────────────────────────────────────────────

describe('handleGetNetwork', () => {
  it('returns network and passphrase for testnet', async () => {
    const result = await handleGetNetwork(makeCtx());
    expect(result.network).toBe('testnet');
    expect(result.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('throws when origin is not in the allowlist', async () => {
    const { isAllowed } = await import('../allowlist');
    vi.mocked(isAllowed).mockResolvedValueOnce(false);

    await expect(handleGetNetwork(makeCtx('https://untrusted.example'))).rejects.toThrow(
      'Origin not allowed'
    );
  });
});

describe('handleRequestAccess', () => {
  it('waits for user approval before adding the origin to the allowlist', async () => {
    const { isAllowed, addToAllowlist } = await import('../allowlist');
    const { enqueueApproval, registerResponseCallbacks } = await import('../response-queue');
    const { openApprovalWindow } = await import('../../../approval-window');

    vi.mocked(isAllowed).mockResolvedValueOnce(false);
    vi.mocked(registerResponseCallbacks).mockImplementation((_requestId, resolve) =>
      resolve({ ok: true })
    );

    const result = await handleRequestAccess(makeCtx('https://dapp.example'));

    expect(enqueueApproval).toHaveBeenCalled();
    expect(openApprovalWindow).toHaveBeenCalledWith('test-req-id', 'grant-access');
    expect(addToAllowlist).toHaveBeenCalledWith(
      'testnet',
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'https://dapp.example'
    );
    expect(result).toEqual({
      smartAccountId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      network: 'testnet',
    });
  });

  it('does not add the origin to the allowlist when the user rejects access', async () => {
    const { isAllowed, addToAllowlist } = await import('../allowlist');
    const { registerResponseCallbacks } = await import('../response-queue');

    vi.mocked(isAllowed).mockResolvedValueOnce(false);
    vi.mocked(registerResponseCallbacks).mockImplementation((_requestId, _resolve, reject) =>
      reject(new Error('User rejected'))
    );

    await expect(handleRequestAccess(makeCtx('https://dapp.example'))).rejects.toThrow(
      'User rejected'
    );
    expect(addToAllowlist).not.toHaveBeenCalled();
  });
});

// ── handleGetSmartAccount ─────────────────────────────────────────────────────

describe('handleGetSmartAccount', () => {
  it('throws when wallet is not set up (no stored address and no params)', async () => {
    await expect(handleGetSmartAccount(makeCtx())).rejects.toThrow('Wallet not set up');
  });

  it('throws when origin is not in the allowlist', async () => {
    const { isAllowed } = await import('../allowlist');
    vi.mocked(isAllowed).mockResolvedValueOnce(false);
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;

    await expect(handleGetSmartAccount(makeCtx('https://untrusted.example'))).rejects.toThrow(
      'Origin not allowed'
    );
  });

  it('returns deployed status when contract exists on-chain', async () => {
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;
    mockGetOwner.mockResolvedValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    const result = await handleGetSmartAccount(makeCtx());
    expect(result.contractId).toBe(CONTRACT_ADDRESS);
    expect(result.deploymentStatus).toBe('deployed');
    expect(result.network).toBe('testnet');
  });

  it('returns not_deployed status when contract does not exist on-chain', async () => {
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;
    mockGetOwner.mockRejectedValue(new Error('contract not found'));

    const result = await handleGetSmartAccount(makeCtx());
    expect(result.contractId).toBe(CONTRACT_ADDRESS);
    expect(result.deploymentStatus).toBe('not_deployed');
    expect(result.network).toBe('testnet');
  });

  it('returns unknown status when RPC call fails for network reasons', async () => {
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;
    mockGetOwner.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await handleGetSmartAccount(makeCtx());
    expect(result.contractId).toBe(CONTRACT_ADDRESS);
    expect(result.deploymentStatus).toBe('unknown');
    expect(result.network).toBe('testnet');
  });

  it('uses smartAccountId from params when provided', async () => {
    const paramContractId = 'CDEF567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD';
    mockGetOwner.mockResolvedValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    const result = await handleGetSmartAccount(
      makeCtx('https://dapp.example', { smartAccountId: paramContractId })
    );
    expect(result.contractId).toBe(paramContractId);
    expect(result.deploymentStatus).toBe('deployed');
  });

  it('returns not_deployed for host object not found errors', async () => {
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;
    mockGetOwner.mockRejectedValue(new Error('host object not found'));

    const result = await handleGetSmartAccount(makeCtx());
    expect(result.deploymentStatus).toBe('not_deployed');
  });

  it('returns not_deployed for unknown contract id errors', async () => {
    localStore['ancore_contract_address'] = CONTRACT_ADDRESS;
    mockGetOwner.mockRejectedValue(new Error('unknown contract id'));

    const result = await handleGetSmartAccount(makeCtx());
    expect(result.deploymentStatus).toBe('not_deployed');
  });
});
