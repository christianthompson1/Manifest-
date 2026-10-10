/**
 * Manifest Studio - Real Solana Client & Wallet Service
 * Implements Phase 2:
 * - Real Wallet Standard & Injected Wallet abstraction (Phantom, Solflare, Standard Wallet)
 * - Strict Honest Security: No private keys, no seed phrases, no fake addresses
 * - Real SolanaClientProvider with Devnet and Mainnet-Beta support
 * - Helius RPC integration with fallback to public cluster RPC
 * - Real SOL balance query from RPC (getBalance)
 * - Real transaction construction, simulation, wallet signing, submission, and confirmation
 * - Real Explorer link generation
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

export type SolanaNetwork = 'devnet' | 'mainnet';

export interface StandardWalletAdapter {
  name: string;
  icon?: string;
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction?(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction?(tx: Transaction): Promise<{ signature: string } | string>;
}

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  balanceSol: number;
  network: SolanaNetwork;
  isWalletDetected: boolean;
  walletName: string | null;
  connecting: boolean;
  rpcEndpoint: string;
  isHeliusActive: boolean;
  error?: string | null;
}

export interface SolanaTransactionPayload {
  recipient: string;
  amountSol: number;
  instructionType?: string;
  programId?: string;
  data?: Record<string, any>;
}

export interface TransactionResult {
  success: boolean;
  signature: string;
  explorerUrl: string;
  error?: string;
  computeUnitsUsed?: number;
  priorityFeeMicroLamports?: number;
  logs?: string[];
}

export interface SimulationResult {
  success: boolean;
  computeUnitsUsed: number;
  logs: string[];
  error?: string;
}

/**
 * Section 16: Real RPC Client Provider
 */
export class SolanaClientProvider {
  private network: SolanaNetwork;
  private customRpcUrl: string;
  private connection: Connection | null = null;

  constructor(network: SolanaNetwork = 'devnet', customRpcUrl: string = '') {
    this.network = network;
    this.customRpcUrl = customRpcUrl;
  }

  public getNetwork(): SolanaNetwork {
    return this.network;
  }

  public setNetwork(network: SolanaNetwork) {
    if (this.network !== network) {
      this.network = network;
      this.connection = null;
    }
  }

  public setCustomRpcUrl(url: string) {
    this.customRpcUrl = url.trim();
    this.connection = null;
  }

  public isHeliusActive(): boolean {
    const key = import.meta.env.VITE_HELIUS_API_KEY;
    return Boolean(key && key.trim().length > 0);
  }

  public getRpcEndpoint(): string {
    if (this.customRpcUrl) return this.customRpcUrl;
    const apiKey = import.meta.env.VITE_HELIUS_API_KEY || '';

    if (this.network === 'mainnet') {
      return apiKey
        ? `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
        : 'https://api.mainnet-beta.solana.com';
    } else {
      return apiKey
        ? `https://devnet.helius-rpc.com/?api-key=${apiKey}`
        : 'https://api.devnet.solana.com';
    }
  }

  public getConnection(): Connection {
    const endpoint = this.getRpcEndpoint();
    if (!this.connection || (this.connection as any)._rpcEndpoint !== endpoint) {
      this.connection = new Connection(endpoint, 'confirmed');
    }
    return this.connection;
  }

  public async getBalance(pubkeyStr: string): Promise<number> {
    try {
      const conn = this.getConnection();
      const pubkey = new PublicKey(pubkeyStr);
      const lamports = await conn.getBalance(pubkey);
      return Number((lamports / LAMPORTS_PER_SOL).toFixed(4));
    } catch (err: any) {
      console.warn('Failed to fetch balance from RPC:', err.message);
      return 0;
    }
  }

  public async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const conn = this.getConnection();
    return conn.getLatestBlockhash('confirmed');
  }

  public async simulateTransaction(tx: Transaction): Promise<SimulationResult> {
    const conn = this.getConnection();
    const sim = await conn.simulateTransaction(tx);
    const logs = sim.value.logs || [];
    const units = sim.value.unitsConsumed || 150;

    if (sim.value.err) {
      return {
        success: false,
        computeUnitsUsed: units,
        logs,
        error: JSON.stringify(sim.value.err),
      };
    }

    return {
      success: true,
      computeUnitsUsed: units,
      logs,
    };
  }

  public async sendRawTransaction(rawTransaction: Buffer | Uint8Array): Promise<string> {
    const conn = this.getConnection();
    return conn.sendRawTransaction(rawTransaction);
  }

  public async confirmTransaction(
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number
  ): Promise<boolean> {
    const conn = this.getConnection();
    const result = await conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    return !result.value.err;
  }
}

/**
 * Section 13 & 23: Solana Wallet Service with standard wallet detection and honest verification
 */
export class SolanaWalletService {
  private static instance: SolanaWalletService;
  private clientProvider: SolanaClientProvider;
  private stateListeners: Set<(state: WalletState) => void> = new Set();

  private state: WalletState = {
    connected: false,
    publicKey: null,
    balanceSol: 0,
    network: 'devnet',
    isWalletDetected: false,
    walletName: null,
    connecting: false,
    rpcEndpoint: '',
    isHeliusActive: false,
    error: null,
  };

  private constructor() {
    this.clientProvider = new SolanaClientProvider('devnet');
    this.updateStateFromClient();
    this.detectInjectedWallets();

    if (typeof window !== 'undefined') {
      window.addEventListener('load', () => this.detectInjectedWallets());
    }
  }

  public static getInstance(): SolanaWalletService {
    if (!SolanaWalletService.instance) {
      SolanaWalletService.instance = new SolanaWalletService();
    }
    return SolanaWalletService.instance;
  }

  public getClientProvider(): SolanaClientProvider {
    return this.clientProvider;
  }

  public getRpcEndpoint(): string {
    return this.clientProvider.getRpcEndpoint();
  }

  public getConnection(): Connection {
    return this.clientProvider.getConnection();
  }

  public getNetwork(): SolanaNetwork {
    return this.state.network;
  }

  public setNetwork(network: SolanaNetwork): void {
    if (this.state.network === network) return;
    this.clientProvider.setNetwork(network);
    this.state.network = network;
    this.updateStateFromClient();
    if (this.state.connected && this.state.publicKey) {
      this.refreshBalance();
    }
    this.notifyState();
  }

  public setCustomRpcUrl(url: string): void {
    this.clientProvider.setCustomRpcUrl(url);
    this.updateStateFromClient();
    this.notifyState();
  }

  private updateStateFromClient() {
    this.state.rpcEndpoint = this.clientProvider.getRpcEndpoint();
    this.state.isHeliusActive = this.clientProvider.isHeliusActive();
  }

  /**
   * Honest Injected Wallet Detection (Phantom, Solflare, Standard Wallet)
   */
  public detectInjectedWallets(): boolean {
    if (typeof window === 'undefined') return false;

    const win = window as any;
    const hasPhantom = Boolean(win.phantom?.solana?.isPhantom);
    const hasSolflare = Boolean(win.solflare?.isSolflare);
    const hasSolana = Boolean(win.solana);

    const isDetected = hasPhantom || hasSolflare || hasSolana;
    let name: string | null = null;
    if (hasPhantom) name = 'Phantom';
    else if (hasSolflare) name = 'Solflare';
    else if (hasSolana) name = 'Solana Standard Wallet';

    this.state.isWalletDetected = isDetected;
    this.state.walletName = name;
    this.notifyState();
    return isDetected;
  }

  private getInjectedProvider(): any {
    if (typeof window === 'undefined') return null;
    const win = window as any;
    return win.phantom?.solana || win.solflare || win.solana || null;
  }

  /**
   * Section 13: Real Wallet Connect
   * Fails honestly with "No compatible Solana wallet detected." if no wallet is present.
   */
  public async connect(): Promise<WalletState> {
    this.state.connecting = true;
    this.state.error = null;
    this.notifyState();

    const provider = this.getInjectedProvider();
    if (!provider) {
      this.state.connecting = false;
      this.state.connected = false;
      this.state.publicKey = null;
      this.state.error = 'No compatible Solana wallet detected.';
      this.notifyState();
      throw new Error('No compatible Solana wallet detected.');
    }

    try {
      const resp = await provider.connect();
      const pubkey = resp?.publicKey?.toString() || provider.publicKey?.toString();
      if (!pubkey) {
        throw new Error('Wallet did not return a valid public key.');
      }

      this.state = {
        ...this.state,
        connected: true,
        publicKey: pubkey,
        connecting: false,
        error: null,
      };

      await this.refreshBalance();
      this.notifyState();
      return this.getState();
    } catch (err: any) {
      this.state.connecting = false;
      this.state.connected = false;
      this.state.publicKey = null;
      this.state.error = err.message || 'Wallet connection was rejected.';
      this.notifyState();
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      const provider = this.getInjectedProvider();
      if (provider && typeof provider.disconnect === 'function') {
        await provider.disconnect();
      }
    } catch (_) {}

    this.state = {
      ...this.state,
      connected: false,
      publicKey: null,
      balanceSol: 0,
      connecting: false,
      error: null,
    };
    this.notifyState();
  }

  /**
   * Section 17: Real RPC getBalance
   */
  public async refreshBalance(): Promise<number> {
    if (!this.state.publicKey) return 0;
    const balance = await this.clientProvider.getBalance(this.state.publicKey);
    this.state.balanceSol = balance;
    this.notifyState();
    return balance;
  }

  /**
   * Real Devnet Airdrop execution
   */
  public async requestAirdrop(): Promise<{ success: boolean; signature: string; message: string }> {
    if (!this.state.publicKey) {
      throw new Error('Wallet must be connected first.');
    }
    if (this.state.network === 'mainnet') {
      throw new Error('Airdrops are not supported on Mainnet.');
    }

    const conn = this.getConnection();
    const pubkey = new PublicKey(this.state.publicKey);

    try {
      const sig = await conn.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
      const latest = await conn.getLatestBlockhash('confirmed');
      await conn.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed'
      );
      await this.refreshBalance();
      return {
        success: true,
        signature: sig,
        message: '1.0 SOL airdropped and confirmed on Devnet!',
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('429') || msg.includes('rate limit')) {
        throw new Error(
          `Solana Devnet faucet rate limit reached. Please use https://faucet.solana.com with address: ${this.state.publicKey}`
        );
      }
      throw new Error(`Airdrop request failed: ${msg}`);
    }
  }

  /**
   * Section 20: Real Simulation via RPC
   */
  public async simulateTransaction(
    payload: SolanaTransactionPayload,
    priorityFeeMicroLamports = 5000
  ): Promise<SimulationResult> {
    if (!this.state.connected || !this.state.publicKey) {
      throw new Error('Wallet not connected.');
    }

    const sender = new PublicKey(this.state.publicKey);
    const recipient = new PublicKey(payload.recipient);
    const lamports = Math.round((payload.amountSol || 0) * LAMPORTS_PER_SOL);

    const tx = new Transaction();
    if (priorityFeeMicroLamports > 0) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
    }
    if (lamports > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: recipient,
          lamports,
        })
      );
    }

    const latest = await this.clientProvider.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = sender;

    return this.clientProvider.simulateTransaction(tx);
  }

  /**
   * Section 18, 21, 22: Real Transaction Path (Build -> Fee -> Sign -> Submit -> Confirm -> Explorer)
   */
  public async executeTransaction(
    payload: SolanaTransactionPayload,
    priorityFeeMicroLamports = 5000
  ): Promise<TransactionResult> {
    if (!this.state.connected || !this.state.publicKey) {
      throw new Error('Wallet not connected. Connect wallet before submitting transactions.');
    }

    const provider = this.getInjectedProvider();
    if (!provider) {
      throw new Error('No compatible Solana wallet detected.');
    }

    const sender = new PublicKey(this.state.publicKey);
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(payload.recipient);
    } catch (_) {
      throw new Error(`Invalid recipient Solana address: "${payload.recipient}"`);
    }

    const lamports = Math.round((payload.amountSol || 0) * LAMPORTS_PER_SOL);

    // 1. Build real transaction
    const tx = new Transaction();
    if (priorityFeeMicroLamports > 0) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
    }
    if (lamports > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: recipient,
          lamports,
        })
      );
    }

    const latest = await this.clientProvider.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = sender;

    // 2. Real simulation first
    const simResult = await this.clientProvider.simulateTransaction(tx);
    if (!simResult.success) {
      return {
        success: false,
        signature: '',
        explorerUrl: '',
        error: `Simulation failed: ${simResult.error || 'Check transaction parameters'}`,
        computeUnitsUsed: simResult.computeUnitsUsed,
        logs: simResult.logs,
      };
    }

    // 3. Request real user approval & signature from injected wallet
    let signature = '';
    try {
      if (typeof provider.signAndSendTransaction === 'function') {
        const res = await provider.signAndSendTransaction(tx);
        signature = typeof res === 'string' ? res : res.signature;
      } else if (typeof provider.signTransaction === 'function') {
        const signed = await provider.signTransaction(tx);
        signature = await this.clientProvider.sendRawTransaction(signed.serialize());
      } else {
        throw new Error('Injected wallet does not support standard transaction signing.');
      }

      // 4. Await RPC confirmation
      await this.clientProvider.confirmTransaction(
        signature,
        latest.blockhash,
        latest.lastValidBlockHeight
      );

      await this.refreshBalance();

      return {
        success: true,
        signature,
        explorerUrl: this.getExplorerUrl(signature),
        computeUnitsUsed: simResult.computeUnitsUsed,
        priorityFeeMicroLamports,
        logs: simResult.logs,
      };
    } catch (err: any) {
      return {
        success: false,
        signature: '',
        explorerUrl: '',
        error: err?.message || 'Transaction signing was rejected or failed.',
      };
    }
  }

  public getExplorerUrl(signatureOrAddress: string, isAddress = false): string {
    const cluster = this.state.network === 'devnet' ? '?cluster=devnet' : '';
    const type = isAddress ? 'address' : 'tx';
    return `https://explorer.solana.com/${type}/${signatureOrAddress}${cluster}`;
  }

  public subscribe(listener: (state: WalletState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  public getState(): WalletState {
    return { ...this.state };
  }

  private notifyState() {
    const current = this.getState();
    this.stateListeners.forEach((l) => l(current));
  }
}
