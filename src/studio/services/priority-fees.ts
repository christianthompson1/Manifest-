/**
 * Manifest Studio - Dynamic Priority Fee Service
 * Implements Section 19: Dynamic Priority Fees
 * - PriorityFeeProvider abstraction
 * - Helius getPriorityFeeEstimate integration
 * - Base fee, Priority fee, and Total estimated fee
 * - Encodes micro-lamports into ComputeBudgetProgram.setComputeUnitPrice
 */

import { SolanaWalletService } from './solana-wallet.ts';

export type PriorityFeeLevel = 'auto' | 'low' | 'medium' | 'high';

export interface PriorityFeeEstimate {
  level: PriorityFeeLevel;
  microLamports: number;
  baseFeeSol: number;       // Base Solana transaction fee (5,000 lamports = 0.000005 SOL)
  priorityFeeSol: number;   // Calculated priority fee in SOL for 200,000 CU
  totalFeeSol: number;      // Total = Base fee + Priority fee
  estimatedSolCost: number; // Alias for estimated priority fee cost in SOL
  source: 'helius_api' | 'cluster_heuristic' | 'fallback';
}

export interface PriorityFeeProvider {
  getEstimate(level: PriorityFeeLevel, accountKeys?: string[]): Promise<PriorityFeeEstimate>;
}

export class HeliusPriorityFeeProvider implements PriorityFeeProvider {
  private static instance: HeliusPriorityFeeProvider;

  public static getInstance(): HeliusPriorityFeeProvider {
    if (!HeliusPriorityFeeProvider.instance) {
      HeliusPriorityFeeProvider.instance = new HeliusPriorityFeeProvider();
    }
    return HeliusPriorityFeeProvider.instance;
  }

  public async getEstimate(
    level: PriorityFeeLevel = 'medium',
    accountKeys: string[] = []
  ): Promise<PriorityFeeEstimate> {
    const walletService = SolanaWalletService.getInstance();
    const endpoint = walletService.getRpcEndpoint();
    const baseFeeSol = 0.000005; // 5,000 lamports

    // Heuristics baseline (micro-lamports per CU)
    const baseEstimates: Record<PriorityFeeLevel, number> = {
      low: 1000,      // 0.000001 lamports/CU
      medium: 50000,  // 0.00005 lamports/CU (~0.00001 SOL per 200k CU)
      high: 250000,   // 0.00025 lamports/CU
      auto: 75000,    // Dynamic average
    };

    // Attempt real Helius Priority Fee RPC call if endpoint is configured
    try {
      if (endpoint.includes('helius')) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'priority-fee-estimate',
            method: 'getPriorityFeeEstimate',
            params: [
              {
                accountKeys: accountKeys.length > 0 ? accountKeys : undefined,
                options: {
                  includeAllPriorityFeeLevels: true,
                },
              },
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const levels = data?.result?.priorityFeeLevels;
          if (levels) {
            let fee = baseEstimates[level];
            if (level === 'low') fee = Math.round(levels.low || baseEstimates.low);
            else if (level === 'medium') fee = Math.round(levels.medium || baseEstimates.medium);
            else if (level === 'high') fee = Math.round(levels.high || baseEstimates.high);
            else if (level === 'auto') {
              fee = Math.round((levels.medium || 50000) * 1.25);
            }

            const priorityFeeSol = Number(((fee * 200000) / 1e15).toFixed(6));
            return {
              level,
              microLamports: Math.max(1000, fee),
              baseFeeSol,
              priorityFeeSol,
              totalFeeSol: Number((baseFeeSol + priorityFeeSol).toFixed(6)),
              estimatedSolCost: priorityFeeSol,
              source: 'helius_api',
            };
          }
        }
      } else {
        // Query standard Solana RPC getRecentPrioritizationFees
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'rpc-prioritization-fees',
            method: 'getRecentPrioritizationFees',
            params: accountKeys.length > 0 ? [accountKeys] : [],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const recent = data?.result as Array<{ slot: number; prioritizationFee: number }> | undefined;
          if (recent && recent.length > 0) {
            const nonZero = recent.map((r) => r.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
            if (nonZero.length > 0) {
              const p25 = nonZero[Math.floor(nonZero.length * 0.25)] || 1000;
              const p50 = nonZero[Math.floor(nonZero.length * 0.5)] || 5000;
              const p75 = nonZero[Math.floor(nonZero.length * 0.75)] || 25000;

              let fee = p50;
              if (level === 'low') fee = Math.max(1000, p25);
              else if (level === 'medium') fee = Math.max(5000, p50);
              else if (level === 'high') fee = Math.max(20000, p75);
              else if (level === 'auto') fee = Math.max(7500, Math.round(p50 * 1.5));

              const priorityFeeSol = Number(((fee * 200000) / 1e15).toFixed(6));
              return {
                level,
                microLamports: fee,
                baseFeeSol,
                priorityFeeSol,
                totalFeeSol: Number((baseFeeSol + priorityFeeSol).toFixed(6)),
                estimatedSolCost: priorityFeeSol,
                source: 'cluster_heuristic',
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn('Priority fee RPC query fallback:', err);
    }

    const fee = baseEstimates[level];
    const priorityFeeSol = Number(((fee * 200000) / 1e15).toFixed(6));

    return {
      level,
      microLamports: fee,
      baseFeeSol,
      priorityFeeSol,
      totalFeeSol: Number((baseFeeSol + priorityFeeSol).toFixed(6)),
      estimatedSolCost: priorityFeeSol,
      source: 'cluster_heuristic',
    };
  }
}
