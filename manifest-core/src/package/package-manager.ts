/**
 * Manifest Package Manager
 *
 * Provides:
 * - TOML manifest serialization and parsing (`manifest.toml`)
 * - Lockfile serialization and parsing (`manifest.lock`)
 * - Dependency addition, removal, and updates
 * - Catalog of official standard and ecosystem packages
 * - Lockfile integrity verification
 */

import {
  ManifestLockFile,
  ManifestPackageConfig,
  PackageResolutionResult,
} from './package-types.ts';
import { DependencyResolver, PackageRegistryMap } from './dependency-resolver.ts';

export const OFFICIAL_PACKAGE_REGISTRY: PackageRegistryMap = {
  'std-core': [
    {
      version: '1.0.0',
      source: 'std',
      dependencies: {},
    },
    {
      version: '1.1.0',
      source: 'std',
      dependencies: {},
    },
  ],
  'std-math': [
    {
      version: '1.0.0',
      source: 'std',
      dependencies: { 'std-core': '^1.0.0' },
    },
  ],
  'std-collections': [
    {
      version: '1.0.0',
      source: 'std',
      dependencies: { 'std-core': '^1.0.0' },
    },
  ],
  json: [
    {
      version: '1.0.0',
      source: 'registry',
      dependencies: { 'std-core': '^1.0.0' },
    },
    {
      version: '1.2.0',
      source: 'registry',
      dependencies: { 'std-core': '^1.0.0' },
    },
  ],
  http: [
    {
      version: '0.2.0',
      source: 'registry',
      dependencies: { json: '^1.0.0' },
    },
  ],
  crypto: [
    {
      version: '0.1.0',
      source: 'registry',
      dependencies: { 'std-core': '^1.0.0' },
    },
  ],
};

export class PackageManager {
  /**
   * Generates a starter manifest.toml for a new Manifest project or package.
   */
  public static initPackage(name: string, description = 'A Manifest project'): string {
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return `[package]
name = "${cleanName}"
version = "0.1.0"
description = "${description}"
authors = ["Manifest Developer <dev@manifest.lang>"]
license = "MIT"
entry = "src/main.manifest"

[dependencies]
std-core = "^1.0.0"

[capabilities]
console = true
`;
  }

  /**
   * Parses a basic TOML package file into ManifestPackageConfig.
   */
  public static parsePackageToml(toml: string): ManifestPackageConfig {
    const config: ManifestPackageConfig = {
      name: 'unnamed',
      version: '0.1.0',
      dependencies: {},
    };

    let currentSection = 'package';
    const lines = toml.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const secMatch = line.match(/^\[([a-zA-Z0-9_.-]+)\]$/);
      if (secMatch) {
        currentSection = secMatch[1].toLowerCase();
        continue;
      }

      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;

      const key = line.slice(0, eqIdx).trim();
      let rawVal = line.slice(eqIdx + 1).trim();

      // Unquote string
      let val: any = rawVal;
      if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
        val = rawVal.slice(1, -1);
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        try {
          val = JSON.parse(rawVal);
        } catch {
          val = [];
        }
      }

      if (currentSection === 'package') {
        if (key === 'name') config.name = String(val);
        else if (key === 'version') config.version = String(val);
        else if (key === 'description') config.description = String(val);
        else if (key === 'license') config.license = String(val);
        else if (key === 'entry') config.entry = String(val);
        else if (key === 'authors' && Array.isArray(val)) config.authors = val;
      } else if (currentSection === 'dependencies') {
        config.dependencies[key] = String(val);
      } else if (currentSection === 'dev-dependencies' || currentSection === 'devdependencies') {
        if (!config.devDependencies) config.devDependencies = {};
        config.devDependencies[key] = String(val);
      }
    }

    return config;
  }

  /**
   * Serializes a ManifestPackageConfig back to clean TOML format.
   */
  public static serializePackageToml(config: ManifestPackageConfig): string {
    const lines: string[] = ['[package]'];
    lines.push(`name = "${config.name}"`);
    lines.push(`version = "${config.version}"`);
    if (config.description) lines.push(`description = "${config.description}"`);
    if (config.authors && config.authors.length > 0) {
      lines.push(`authors = ${JSON.stringify(config.authors)}`);
    }
    if (config.license) lines.push(`license = "${config.license}"`);
    if (config.entry) lines.push(`entry = "${config.entry}"`);

    lines.push('');
    lines.push('[dependencies]');
    for (const [dep, ver] of Object.entries(config.dependencies)) {
      lines.push(`${dep} = "${ver}"`);
    }

    if (config.devDependencies && Object.keys(config.devDependencies).length > 0) {
      lines.push('');
      lines.push('[dev-dependencies]');
      for (const [dep, ver] of Object.entries(config.devDependencies)) {
        lines.push(`${dep} = "${ver}"`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Serializes a lockfile to reproducible JSON/TOML format.
   */
  public static serializeLockfile(lock: ManifestLockFile): string {
    return JSON.stringify(lock, null, 2) + '\n';
  }

  /**
   * Parses a lockfile.
   */
  public static parseLockfile(content: string): ManifestLockFile {
    return JSON.parse(content) as ManifestLockFile;
  }

  /**
   * Adds or updates a dependency in manifest.toml and resolves manifest.lock.
   */
  public static addDependency(
    tomlContent: string,
    pkgName: string,
    versionConstraint = '^1.0.0',
    registry: PackageRegistryMap = OFFICIAL_PACKAGE_REGISTRY
  ): { ok: boolean; toml: string; lock?: string; result: PackageResolutionResult } {
    const config = this.parsePackageToml(tomlContent);
    config.dependencies[pkgName] = versionConstraint;

    const result = DependencyResolver.resolve(config, registry);
    if (!result.ok || !result.lockfile) {
      return { ok: false, toml: tomlContent, result };
    }

    const updatedToml = this.serializePackageToml(config);
    const updatedLock = this.serializeLockfile(result.lockfile);
    return { ok: true, toml: updatedToml, lock: updatedLock, result };
  }

  /**
   * Removes a dependency from manifest.toml and re-resolves manifest.lock.
   */
  public static removeDependency(
    tomlContent: string,
    pkgName: string,
    registry: PackageRegistryMap = OFFICIAL_PACKAGE_REGISTRY
  ): { ok: boolean; toml: string; lock?: string; result: PackageResolutionResult } {
    const config = this.parsePackageToml(tomlContent);
    delete config.dependencies[pkgName];

    const result = DependencyResolver.resolve(config, registry);
    if (!result.ok || !result.lockfile) {
      return { ok: false, toml: tomlContent, result };
    }

    const updatedToml = this.serializePackageToml(config);
    const updatedLock = this.serializeLockfile(result.lockfile);
    return { ok: true, toml: updatedToml, lock: updatedLock, result };
  }

  /**
   * Validates package configuration and lockfile integrity.
   */
  public static verifyPackage(
    tomlContent: string,
    lockContent?: string,
    registry: PackageRegistryMap = OFFICIAL_PACKAGE_REGISTRY
  ): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    let config: ManifestPackageConfig;
    try {
      config = this.parsePackageToml(tomlContent);
    } catch (err: any) {
      return { ok: false, errors: [`Malformed manifest.toml: ${err.message}`] };
    }

    if (!config.name || config.name === 'unnamed') {
      errors.push('Package is missing a valid [package] name');
    }
    if (!config.version) {
      errors.push('Package is missing a valid [package] version');
    }

    const resolution = DependencyResolver.resolve(config, registry);
    if (!resolution.ok) {
      for (const diag of resolution.diagnostics) {
        errors.push(`[${diag.code}] ${diag.message}`);
      }
    }

    if (lockContent) {
      try {
        const lock = this.parseLockfile(lockContent);
        for (const [depName, locked] of Object.entries(lock.packages)) {
          if (!locked.integrity.startsWith('sha256:')) {
            errors.push(`Corrupted integrity checksum for locked package '${depName}'`);
          }
        }
      } catch (err: any) {
        errors.push(`Invalid manifest.lock format: ${err.message}`);
      }
    }

    return { ok: errors.length === 0, errors };
  }
}
