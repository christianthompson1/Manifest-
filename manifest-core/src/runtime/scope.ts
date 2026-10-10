export class Scope {
  private values: Map<string, any> = new Map();
  private parent?: Scope;

  constructor(parent?: Scope) {
    this.parent = parent;
  }

  public set(name: string, value: any): void {
    if (this.values.has(name)) {
      this.values.set(name, value);
      return;
    }
    if (this.parent && this.parent.has(name)) {
      this.parent.set(name, value);
      return;
    }
    this.values.set(name, value);
  }

  public get(name: string): any {
    if (this.values.has(name)) {
      return this.values.get(name);
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return undefined;
  }

  public has(name: string): boolean {
    if (this.values.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  public getAll(): Record<string, any> {
    const parentValues = this.parent ? this.parent.getAll() : {};
    const localValues: Record<string, any> = {};
    for (const [k, v] of this.values.entries()) {
      localValues[k] = v;
    }
    return { ...parentValues, ...localValues };
  }
}
