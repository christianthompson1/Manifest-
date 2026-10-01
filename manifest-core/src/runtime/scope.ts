/**
 * Manifest Core v0.1 - Lexical Scope Environment
 * Manages variables across global, block, and action scopes.
 */

import { ManifestValue } from './values.ts';
import { ManifestError } from '../errors/manifest-error.ts';

export class Scope {
  private readonly variables: Map<string, ManifestValue> = new Map();
  public readonly parent?: Scope;

  constructor(parent?: Scope) {
    this.parent = parent;
  }

  /**
   * Sets or updates a variable.
   * If the variable exists in an ancestor scope, it updates that ancestor scope.
   * Otherwise, it defines it in the current scope.
   */
  public set(name: string, value: ManifestValue): void {
    if (this.variables.has(name)) {
      this.variables.set(name, value);
      return;
    }
    if (this.parent && this.parent.has(name)) {
      this.parent.set(name, value);
      return;
    }
    this.variables.set(name, value);
  }

  /**
   * Explicitly defines a variable strictly in the current local scope.
   */
  public define(name: string, value: ManifestValue): void {
    this.variables.set(name, value);
  }

  /**
   * Gets a variable's value from this scope or nearest ancestor.
   */
  public get(name: string, line: number = 1): ManifestValue {
    if (this.variables.has(name)) {
      return this.variables.get(name)!;
    }
    if (this.parent) {
      return this.parent.get(name, line);
    }
    throw new ManifestError({
      message: `The variable '${name}' has not been set yet.`,
      line,
      phase: 'runtime',
      hint: `Use 'SET ${name} TO <value>' before using it.`,
      example: `SET ${name} TO 100`,
    });
  }

  /**
   * Checks if variable exists in this scope or any ancestor.
   */
  public has(name: string): boolean {
    if (this.variables.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  /**
   * Returns a dictionary of all active variables visible from this scope.
   */
  public getAll(): Record<string, ManifestValue> {
    const all: Record<string, ManifestValue> = this.parent ? this.parent.getAll() : {};
    for (const [key, val] of this.variables.entries()) {
      all[key] = val;
    }
    return all;
  }
}
