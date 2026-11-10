/**
 * Manifest Package System Types
 * Defines manifest.toml, manifest.lock, and dependency resolution types.
 */

export interface ManifestPackageConfig {
  name: string;
  version: string;
  description?: string;
  authors?: string[];
  license?: string;
  entry?: string;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  capabilities?: string[];
  targets?: string[];
}

export interface LockedPackage {
  version: string;
  integrity: string; // sha256:...
  source: 'std' | 'local' | 'registry';
  dependencies?: Record<string, string>;
}

export interface ManifestLockFile {
  lockfileVersion: number;
  packages: Record<string, LockedPackage>;
}

export interface ResolvedDependencyNode {
  name: string;
  version: string;
  source: 'std' | 'local' | 'registry';
  dependencies: Record<string, string>;
  integrity: string;
  depth: number;
}

export interface PackageResolutionResult {
  ok: boolean;
  lockfile?: ManifestLockFile;
  tree?: ResolvedDependencyNode[];
  diagnostics: Array<{
    code: 'E_CIRCULAR_DEPENDENCY' | 'E_DEPENDENCY_CONFLICT' | 'E_PACKAGE_NOT_FOUND' | 'E_INVALID_SEMVER';
    message: string;
    package?: string;
  }>;
}
