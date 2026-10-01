/**
 * Manifest Core v0.1 - Capability & Module System
 * Provides clean registration and tracking for USE declarations.
 * Manifest Core remains completely independent of external dependencies.
 */

export interface CapabilityDefinition {
  name: string;
  description: string;
  version?: string;
  permissions?: string[];
}

export class CapabilityRegistry {
  private readonly registeredCapabilities: Map<string, CapabilityDefinition> = new Map();
  private readonly activeCapabilities: Set<string> = new Set();

  constructor() {
    // Register known future capability placeholders so they are recognized
    this.register({
      name: 'WEB',
      description: 'Web application & HTTP networking capabilities',
      permissions: ['network'],
    });
    this.register({
      name: 'DATABASE',
      description: 'Data persistence and storage capability interface',
      permissions: ['storage'],
    });
    this.register({
      name: 'SOLANA',
      description: 'Solana blockchain interaction capability interface',
      permissions: ['blockchain', 'network'],
    });
  }

  /**
   * Registers a capability definition. Future packages will use this method
   * to register without touching the core parser.
   */
  public register(cap: CapabilityDefinition): void {
    this.registeredCapabilities.set(cap.name.toUpperCase(), cap);
  }

  /**
   * Activates a capability for the current program execution (e.g. from USE <CAPABILITY>).
   */
  public use(capabilityName: string): CapabilityDefinition {
    const key = capabilityName.toUpperCase();
    this.activeCapabilities.add(key);

    const existing = this.registeredCapabilities.get(key);
    if (existing) {
      return existing;
    }

    // Dynamic registration placeholder for user-defined or upcoming packages
    const dynamicCap: CapabilityDefinition = {
      name: key,
      description: `External capability '${key}'`,
    };
    this.registeredCapabilities.set(key, dynamicCap);
    return dynamicCap;
  }

  /**
   * Checks if a capability is active in the current program.
   */
  public isUsed(capabilityName: string): boolean {
    return this.activeCapabilities.has(capabilityName.toUpperCase());
  }

  /**
   * Returns list of all active capabilities used in the current run.
   */
  public getActiveCapabilities(): string[] {
    return Array.from(this.activeCapabilities);
  }

  /**
   * Resets active capabilities for a new execution run.
   */
  public reset(): void {
    this.activeCapabilities.clear();
  }
}
