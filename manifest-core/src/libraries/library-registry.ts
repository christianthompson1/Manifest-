/**
 * Manifest Library & Package System
 * Provides capability metadata, permission controls, and runtime adapters
 * allowing Manifest applications to orchestrate third-party libraries
 * without requiring the developer to hand-write underlying JavaScript or Rust.
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

export interface LibraryAdapter {
  init?: (container: HTMLElement | any, options?: Record<string, any>) => void;
  applyAnimation?: (element: HTMLElement, config: AnimateConfig) => void;
  renderIcon?: (name: string, size?: number, color?: string) => string | HTMLElement;
  renderChart?: (canvas: HTMLCanvasElement, data: any) => any;
}

export interface AnimateConfig {
  initial?: Record<string, any>;
  to?: Record<string, any>;
  duration?: number;
  ease?: string;
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

    // 2. Lucide Icons
    this.registerLibrary({
      name: 'lucide',
      version: '0.546.0',
      description: 'Clean, consistent SVG icons directly in Manifest UI without SVG markup',
      capabilities: ['icons', 'svg', 'ui'],
      requiredPermissions: [],
      offlineSupported: true,
      npmPackage: 'lucide-react',
    }, {
      renderIcon: (name: string, size = 18, color = 'currentColor') => {
        // Return structured SVG icon placeholder or DOM element
        const iconName = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const span = document.createElement('span');
        span.className = `manifest-icon manifest-icon-${iconName}`;
        span.setAttribute('data-icon', iconName);
        span.style.display = 'inline-flex';
        span.style.alignItems = 'center';
        span.style.justifyContent = 'center';
        span.style.width = `${size}px`;
        span.style.height = `${size}px`;
        span.style.color = color;
        span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
        return span;
      },
    });

    // 3. Chart.js Adapter
    this.registerLibrary({
      name: 'chartjs',
      version: '4.4.0',
      description: 'Responsive canvas charts for data-driven Manifest dashboards',
      capabilities: ['charts', 'canvas', 'visualization'],
      requiredPermissions: [],
      offlineSupported: true,
      npmPackage: 'chart.js',
    });

    // 4. Three.js 3D Adapter
    this.registerLibrary({
      name: 'threejs',
      version: '0.170.0',
      description: '3D scenes, WebGL shaders and spatial UI for Manifest apps',
      capabilities: ['3d', 'webgl', 'spatial'],
      requiredPermissions: ['webgl'],
      offlineSupported: true,
      npmPackage: 'three',
    });

    // 5. Solana Web3 & Wallet Adapter
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

  public hasLibrary(name: string): boolean {
    return this.libraries.has(name.toLowerCase());
  }

  public listLibraries(): LibraryManifest[] {
    return Array.from(this.libraries.values());
  }

  public validateManifestLibraries(
    libs: Array<{ name: string; requestedCapabilities?: string[] }>,
    grantedPermissions: PermissionKind[] = ['network', 'wallet', 'storage', 'webgl']
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const lib of libs) {
      const manifest = this.getLibrary(lib.name);
      if (!manifest) {
        errors.push(`Unknown library "${lib.name}"`);
        continue;
      }
      const permCheck = this.checkPermissions(lib.name, grantedPermissions);
      if (!permCheck.allowed) {
        errors.push(`Library "${lib.name}" requires permissions: ${permCheck.missingPermissions.join(', ')}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates whether a requested library's required permissions are allowed in manifest.toml
   */
  public checkPermissions(
    libraryName: string,
    grantedPermissions: PermissionKind[] = []
  ): { allowed: boolean; missingPermissions: PermissionKind[] } {
    const lib = this.getLibrary(libraryName);
    if (!lib) {
      return { allowed: true, missingPermissions: [] };
    }

    const missing = lib.requiredPermissions.filter(
      (perm) => !grantedPermissions.includes(perm)
    );

    return {
      allowed: missing.length === 0,
      missingPermissions: missing,
    };
  }
}
