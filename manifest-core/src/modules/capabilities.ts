export interface CapabilityModule {
  name: string;
  version: string;
  description: string;
  init?(): Promise<void> | void;
}

export class CapabilityRegistry {
  private static modules: Map<string, CapabilityModule> = new Map();

  public static register(module: CapabilityModule): void {
    this.modules.set(module.name.toUpperCase(), module);
  }

  public static get(name: string): CapabilityModule | undefined {
    return this.modules.get(name.toUpperCase());
  }

  public static has(name: string): boolean {
    return this.modules.has(name.toUpperCase());
  }

  public static getActiveCapabilities(): string[] {
    return Array.from(this.modules.keys());
  }

  public getActiveCapabilities(): string[] {
    return CapabilityRegistry.getActiveCapabilities();
  }
}
