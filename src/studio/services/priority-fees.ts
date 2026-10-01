/**
 * Manifest Studio - Dynamic Priority Fee Service
 * Implements Section 17: Dynamic Priority Fees
 * - PriorityFeeProvider abstraction
 * - Helius getPriorityFeeEstimate integration
 * - Levels: AUTO, LOW, MEDIUM, HIGH (Default: MEDIUM)
 * - Computes micro-lamports per compute unit
 */

import { SolanaWalletService } from './solana-wallet.ts';

export type PriorityFeeLevel = 'auto' | 'low' | 'medium' | 'high';

export interface PriorityFeeEstimate {
  level: PriorityFeeLevel;
  microLamports: number;
  estimatedSolCost: number; // For standard 200,000 CU limit
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

    // Base heuristics (micro-lamports per CU)
    const baseEstimates: Record<PriorityFeeLevel, number> = {
      low: 1000,      // 0.000001 lamports/CU
      medium: 50000,  // 0.00005 lamports/CU (~0.00001 SOL per 200k CU)
      high: 250000,   // 0.00025 lamports/CU
      auto: 75000,    // Dynamic average
    };

    // Attempt real Helius Priority Fee RPC call if API key / endpoint is configured
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
              // Auto balances between medium and high
              fee = Math.round((levels.medium || 50000) * 1.25);
            }

            const estimatedSol = (fee * 200000) / 1e15; // microLamports to SOL
            return {
              level,
              microLamports: Math.max(1000, fee),
              estimatedSolCost: Number(estimatedSol.toFixed(6)),
              source: 'helius_api',
            };
          }
        }
      }
    } catch (err) {
      console.warn('Helius priority fee RPC call fallback:', err);
    }

    // Cluster fallback estimate
    const fee = baseEstimates[level];
    const estimatedSol = (fee * 200000) / 1e15;

    return {
      level,
      microLamports: fee,
      estimatedSolCost: Number(estimatedSol.toFixed(6)),
      source: 'cluster_heuristic',
    };
  }
}
