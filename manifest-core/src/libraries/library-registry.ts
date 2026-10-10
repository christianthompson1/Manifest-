/**
 * Manifest Library & Package System
 * Section 10: Library Foundation & LibraryAdapter abstraction
 * Provides capability metadata, permission controls, compiler transforms, and runtime adapters
 * allowing Manifest applications to orchestrate third-party libraries.
 */

export interface LibraryCapability {
  id: string;
  name: string;
  description: string;
}

export type PermissionKind =
  | 'network'
  | 'storage'
  | 'camera'
  | 'microphone'
  | 'wallet'
  | 'filesystem'
  | 'notifications'
  | 'webgl';

export interface LibraryManifest {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  requiredPermissions: PermissionKind[];
  offlineSupported: boolean;
  npmPackage?: string;
  crateName?: string;
}

/**
 * Section 10: Canonical LibraryAdapter Abstraction
 */
export interface LibraryAdapter {
  readonly id: string;
  readonly version: string;
  readonly permissions: PermissionKind[];
  readonly manifestSyntax: string;
  compilerTransform(node: any): string;
  runtimeIntegration(container: HTMLElement, options?: Record<string, any>): any;
  renderIcon?(name: string, size?: number, color?: string): string | HTMLElement;
  applyAnimation?(element: HTMLElement, config: AnimateConfig): void;
}

export interface AnimateConfig {
  initial?: Record<string, any>;
  to?: Record<string, any>;
  duration?: number;
  ease?: string;
}

/**
 * Section 10: First Real End-to-End Adapter: Lucide Icons
 */
export class LucideLibraryAdapter implements LibraryAdapter {
  public readonly id = 'lucide';
  public readonly version = '0.546.0';
  public readonly permissions: PermissionKind[] = [];
  public readonly manifestSyntax = 'ICON "name" [SIZE n] [COLOR "#hex"]';

  private static readonly ICONS: Record<string, string> = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  };

  public compilerTransform(node: any): string {
    const iconName = String(node.name || 'sparkles').toLowerCase();
    const size = node.size || 20;
    const color = node.color || 'currentColor';
    return `__manifest.libraries.lucide.renderIcon("${iconName}", ${size}, "${color}")`;
  }

  public runtimeIntegration(container: HTMLElement, options: Record<string, any> = {}): HTMLElement {
    const icon = this.renderIcon(options.name || 'sparkles', options.size || 20, options.color || 'currentColor');
    if (typeof icon !== 'string') {
      container.appendChild(icon);
      return icon;
    }
    const span = document.createElement('span');
    span.innerHTML = icon;
    container.appendChild(span);
    return span;
  }

  public renderIcon(name: string, size = 20, color = 'currentColor'): HTMLElement {
    const clean = name.toLowerCase().trim();
    const paths = LucideLibraryAdapter.ICONS[clean] || LucideLibraryAdapter.ICONS.sparkles;

    const span = document.createElement('span');
    span.className = `manifest-icon manifest-icon-${clean}`;
    span.setAttribute('data-lucide', clean);
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.style.color = color;
    span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    return span;
  }
}

export class LibraryRegistry {
  private static instance: LibraryRegistry;
  private libraries: Map<string, LibraryManifest> = new Map();
  private adapters: Map<string, LibraryAdapter> = new Map();

  private constructor() {
    this.registerDefaultLibraries();
  }

  public static getInstance(): LibraryRegistry {
    if (!LibraryRegistry.instance) {
      LibraryRegistry.instance = new LibraryRegistry();
    }
    return LibraryRegistry.instance;
  }

  private registerDefaultLibraries() {
    // 1. Framer Motion Adapter
    this.registerLibrary({
      name: 'framer-motion',
      version: '12.0.0',
      description: 'Production-ready animations and gesture orchestration for Manifest UI',
      capabilities: ['animation', 'transitions', 'gestures'],
      requiredPermissions: [],
      offlineSupported: true,
      npmPackage: 'motion',
    }, {
      id: 'framer-motion',
      version: '12.0.0',
      permissions: [],
      manifestSyntax: 'ANIMATE [INITIAL ...] [TO ...] [DURATION n]',
      compilerTransform: () => '',
      runtimeIntegration: () => {},
      applyAnimation: (element: HTMLElement, config: AnimateConfig) => {
        const duration = (config.duration || 300) / 1000;
        const ease = config.ease || 'ease-out';
        element.style.transition = `all ${duration}s ${ease}`;
        if (config.to) {
          if (config.to.opacity !== undefined) element.style.opacity = String(config.to.opacity);
          if (config.to.scale !== undefined) element.style.transform = `scale(${config.to.scale})`;
          if (config.to.x !== undefined || config.to.y !== undefined) {
            const x = config.to.x || 0;
            const y = config.to.y || 0;
            element.style.transform = `translate(${x}px, ${y}px)`;
          }
        }
      },
    });

    // 2. Lucide Icons End-to-End Real Adapter (Section 10)
    const lucideAdapter = new LucideLibraryAdapter();
    this.registerLibrary({
      name: 'lucide',
      version: lucideAdapter.version,
      description: 'Clean, consistent SVG icons directly in Manifest UI without hand-crafted SVG markup',
      capabilities: ['icons', 'svg', 'ui'],
      requiredPermissions: [],
      offlineSupported: true,
      npmPackage: 'lucide-react',
    }, lucideAdapter);

    // 3. Solana Web3 Adapter
    this.registerLibrary({
      name: 'solana-web3',
      version: '1.95.0',
      description: 'Solana blockchain interaction, RPC queries, transaction creation and wallet connection',
      capabilities: ['blockchain', 'solana', 'transactions', 'rpc', 'wallet', 'network'],
      requiredPermissions: ['network', 'wallet'],
      offlineSupported: false,
      npmPackage: '@solana/web3.js',
    });
  }

  public registerLibrary(manifest: LibraryManifest, adapter?: LibraryAdapter) {
    this.libraries.set(manifest.name.toLowerCase(), manifest);
    if (adapter) {
      this.adapters.set(manifest.name.toLowerCase(), adapter);
    }
  }

  public getLibrary(name: string): LibraryManifest | undefined {
    return this.libraries.get(name.toLowerCase());
  }

  public getAdapter(name: string): LibraryAdapter | undefined {
    return this.adapters.get(name.toLowerCase());
  }

  public getAllLibraries(): LibraryManifest[] {
    return Array.from(this.libraries.values());
  }

  public listLibraries(): LibraryManifest[] {
    return this.getAllLibraries();
  }

  public validateManifestLibraries(
    requests: Array<{ name: string; requestedCapabilities?: string[] }>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const req of requests) {
      const lib = this.getLibrary(req.name);
      if (!lib) {
        errors.push(`Library "${req.name}" is not registered in the Manifest Library Registry.`);
        continue;
      }
      if (req.requestedCapabilities && req.requestedCapabilities.length > 0) {
        for (const cap of req.requestedCapabilities) {
          if (!lib.capabilities.includes(cap)) {
            errors.push(
              `Capability "${cap}" is not declared by library "${req.name}". Available: ${lib.capabilities.join(', ')}`
            );
          }
        }
      }
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
