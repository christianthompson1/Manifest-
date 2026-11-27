/**
 * Solana JSON-RPC Proxy Allowlist & Validation Policy
 * Enforces strict method allowlisting, JSON-RPC 2.0 schema checks, and Devnet-only airdrop rules
 * before any upstream RPC fetch is executed.
 */

export type SolanaProxyNetwork = 'devnet' | 'mainnet';

export const ALLOWED_SOLANA_RPC_METHODS: ReadonlySet<string> = new Set([
  'getBalance',
  'getLatestBlockhash',
  'getBlockHeight',
  'getSlot',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'getAccountInfo',
  'simulateTransaction',
  'sendTransaction',
  'getSignatureStatuses',
  'getRecentPrioritizationFees',
  'getPriorityFeeEstimate',
  'requestAirdrop',
]);

export const DEVNET_ONLY_SOLANA_RPC_METHODS: ReadonlySet<string> = new Set([
  'requestAirdrop',
]);

export interface RpcValidationResult {
  allowed: boolean;
  httpStatus: number;
  method?: string;
  error?: {
    code: number;
    message: string;
  };
}

export function validateSolanaRpcRequest(
  payload: unknown,
  network: SolanaProxyNetwork
): RpcValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      allowed: false,
      httpStatus: 400,
      error: {
        code: -32600,
        message: 'Invalid Request: JSON-RPC payload must be a single JSON object (batch requests are rejected)',
      },
    };
  }

  const req = payload as Record<string, unknown>;

  if (req.jsonrpc !== '2.0') {
    return {
      allowed: false,
      httpStatus: 400,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc version must be "2.0"',
      },
    };
  }

  if (
    req.id !== undefined &&
    req.id !== null &&
    typeof req.id !== 'string' &&
    typeof req.id !== 'number'
  ) {
    return {
      allowed: false,
      httpStatus: 400,
      error: {
        code: -32600,
        message: 'Invalid Request: id must be string, number, or null',
      },
    };
  }

  if (typeof req.method !== 'string' || req.method.length === 0) {
    return {
      allowed: false,
      httpStatus: 400,
      error: {
        code: -32600,
        message: 'Invalid Request: method must be a non-empty string',
      },
    };
  }

  // Exact, case-sensitive allowlist check (no trimming, no prefix/wildcard matching)
  if (!ALLOWED_SOLANA_RPC_METHODS.has(req.method)) {
    return {
      allowed: false,
      httpStatus: 403,
      method: req.method,
      error: {
        code: -32601,
        message: `RPC method '${req.method}' is not permitted by Manifest Studio Solana RPC proxy allowlist`,
      },
    };
  }

  if (DEVNET_ONLY_SOLANA_RPC_METHODS.has(req.method) && network !== 'devnet') {
    return {
      allowed: false,
      httpStatus: 403,
      method: req.method,
      error: {
        code: -32601,
        message: `RPC method '${req.method}' is restricted to devnet`,
      },
    };
  }

  if (
    req.params !== undefined &&
    !Array.isArray(req.params) &&
    (typeof req.params !== 'object' || req.params === null)
  ) {
    return {
      allowed: false,
      httpStatus: 400,
      method: req.method,
      error: {
        code: -32602,
        message: 'Invalid params: expected array or object',
      },
    };
  }

  if (Array.isArray(req.params) && req.params.length > 16) {
    return {
      allowed: false,
      httpStatus: 400,
      method: req.method,
      error: {
        code: -32602,
        message: 'Invalid params: parameter array exceeds maximum allowed length (16)',
      },
    };
  }

  return {
    allowed: true,
    httpStatus: 200,
    method: req.method,
  };
}
