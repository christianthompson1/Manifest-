/**
 * Manifest Virtual Machine (MVM) - Memory Management & Mark-and-Sweep Garbage Collection
 * 
 * Provides:
 * - Managed HeapArena with slot reuse via free-list
 * - Exact root tracking across operand stack, global slots, and active call-frame locals
 * - Mark-and-sweep garbage collection with protection against collecting active references
 * - Dedicated Bytes heap object for safe binary data manipulation
 * - Configurable heap limits and collection statistics
 */

export type MvmValue =
  | { kind: 'void' }
  | { kind: 'i64'; value: bigint }
  | { kind: 'f64'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'array_ref'; id: number }
  | { kind: 'map_ref'; id: number }
  | { kind: 'struct_ref'; id: number }
  | { kind: 'enum_ref'; id: number }
  | { kind: 'bytes_ref'; id: number };

export interface MvmArrayObject {
  kind: 'array';
  items: MvmValue[];
  marked: boolean;
}

export interface MvmMapObject {
  kind: 'map';
  entries: Map<string, MvmValue>;
  marked: boolean;
}

export interface MvmStructObject {
  kind: 'struct';
  structIdx: number;
  name: string;
  fields: MvmValue[];
  marked: boolean;
}

export interface MvmEnumObject {
  kind: 'enum';
  enumIdx: number;
  variantIdx: number;
  variantName: string;
  payload: MvmValue[];
  marked: boolean;
}

export interface MvmBytesObject {
  kind: 'bytes';
  buffer: Uint8Array;
  marked: boolean;
}

export type MvmHeapObject =
  | MvmArrayObject
  | MvmMapObject
  | MvmStructObject
  | MvmEnumObject
  | MvmBytesObject;

export type MvmAllocObject =
  | Omit<MvmArrayObject, 'marked'>
  | Omit<MvmMapObject, 'marked'>
  | Omit<MvmStructObject, 'marked'>
  | Omit<MvmEnumObject, 'marked'>
  | Omit<MvmBytesObject, 'marked'>;

export interface RootProvider {
  getStackRoots(): MvmValue[];
  getGlobalRoots(): MvmValue[];
  getFrameRoots(): MvmValue[];
}

export interface GcStatistics {
  collections: number;
  objectsAllocated: number;
  objectsReclaimed: number;
  currentLive: number;
  peakLive: number;
  maxHeapLimit: number;
}

export class MvmHeapArena {
  private objects: (MvmHeapObject | null)[] = [];
  private freeList: number[] = [];
  private liveCount = 0;
  private peakLive = 0;
  private collections = 0;
  private objectsAllocated = 0;
  private objectsReclaimed = 0;

  constructor(public readonly maxObjects: number = 65536) {}

  public getLiveCount(): number {
    return this.liveCount;
  }

  public getStats(): GcStatistics {
    return {
      collections: this.collections,
      objectsAllocated: this.objectsAllocated,
      objectsReclaimed: this.objectsReclaimed,
      currentLive: this.liveCount,
      peakLive: this.peakLive,
      maxHeapLimit: this.maxObjects,
    };
  }

  /**
   * Allocates a new heap object. If the heap limit is reached, triggers
   * a mark-and-sweep collection using the supplied root provider.
   * If live count remains at or above maxObjects, throws an allocation error.
   */
  public alloc(obj: MvmAllocObject, roots?: RootProvider): number {
    if (this.liveCount >= this.maxObjects) {
      if (roots) {
        this.collectGarbage(roots);
      }
      if (this.liveCount >= this.maxObjects) {
        throw new Error(
          `E_MVM_MEMORY_LIMIT: MVM heap limit exceeded (${this.liveCount}/${this.maxObjects} objects)`
        );
      }
    }

    const fullObj: MvmHeapObject = { ...obj, marked: false } as MvmHeapObject;
    let id: number;

    if (this.freeList.length > 0) {
      id = this.freeList.pop()!;
      this.objects[id] = fullObj;
    } else {
      id = this.objects.length;
      this.objects.push(fullObj);
    }

    this.liveCount++;
    this.objectsAllocated++;
    if (this.liveCount > this.peakLive) {
      this.peakLive = this.liveCount;
    }

    return id;
  }

  public get(id: number): MvmHeapObject {
    const obj = this.objects[id];
    if (!obj) {
      throw new Error(`E_MVM_INVALID_REF: Invalid or collected heap reference #${id}`);
    }
    return obj;
  }

  public getArray(id: number): MvmArrayObject {
    const obj = this.get(id);
    if (obj.kind !== 'array') {
      throw new Error(`E_MVM_TYPE_ERROR: Expected Array at heap ref #${id}, found ${obj.kind}`);
    }
    return obj;
  }

  public getMap(id: number): MvmMapObject {
    const obj = this.get(id);
    if (obj.kind !== 'map') {
      throw new Error(`E_MVM_TYPE_ERROR: Expected Map at heap ref #${id}, found ${obj.kind}`);
    }
    return obj;
  }

  public getStruct(id: number): MvmStructObject {
    const obj = this.get(id);
    if (obj.kind !== 'struct') {
      throw new Error(`E_MVM_TYPE_ERROR: Expected Struct at heap ref #${id}, found ${obj.kind}`);
    }
    return obj;
  }

  public getEnum(id: number): MvmEnumObject {
    const obj = this.get(id);
    if (obj.kind !== 'enum') {
      throw new Error(`E_MVM_TYPE_ERROR: Expected Enum at heap ref #${id}, found ${obj.kind}`);
    }
    return obj;
  }

  public getBytes(id: number): MvmBytesObject {
    const obj = this.get(id);
    if (obj.kind !== 'bytes') {
      throw new Error(`E_MVM_TYPE_ERROR: Expected Bytes at heap ref #${id}, found ${obj.kind}`);
    }
    return obj;
  }

  /**
   * Mark-and-sweep garbage collection:
   * 1. Mark phase: Traversing all stack roots, global roots, and call-frame local roots.
   * 2. Sweep phase: Reclaiming all unmarked objects into the free-list.
   */
  public collectGarbage(roots: RootProvider): { reclaimed: number; liveAfter: number } {
    this.collections++;

    // 1. Mark Phase
    const markValue = (val: MvmValue): void => {
      let refId: number | null = null;
      switch (val.kind) {
        case 'array_ref':
        case 'map_ref':
        case 'struct_ref':
        case 'enum_ref':
        case 'bytes_ref':
          refId = val.id;
          break;
        default:
          return;
      }

      if (refId === null || refId < 0 || refId >= this.objects.length) return;
      const obj = this.objects[refId];
      if (!obj || obj.marked) return;

      obj.marked = true;

      // Recursively mark children
      switch (obj.kind) {
        case 'array':
          for (const item of obj.items) markValue(item);
          break;
        case 'map':
          for (const item of obj.entries.values()) markValue(item);
          break;
        case 'struct':
          for (const field of obj.fields) markValue(field);
          break;
        case 'enum':
          for (const arg of obj.payload) markValue(arg);
          break;
        case 'bytes':
          // Raw binary bytes have no child references
          break;
      }
    };

    // Mark stack roots
    for (const v of roots.getStackRoots()) {
      markValue(v);
    }
    // Mark global roots
    for (const v of roots.getGlobalRoots()) {
      markValue(v);
    }
    // Mark call frame roots
    for (const v of roots.getFrameRoots()) {
      markValue(v);
    }

    // 2. Sweep Phase
    let reclaimed = 0;
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj === null) continue;

      if (!obj.marked) {
        // Unreachable: reclaim slot into freeList
        this.objects[i] = null;
        this.freeList.push(i);
        this.liveCount--;
        this.objectsReclaimed++;
        reclaimed++;
      } else {
        // Reachable: reset mark flag for next collection cycle
        obj.marked = false;
      }
    }

    return { reclaimed, liveAfter: this.liveCount };
  }

  /**
   * Formats an MVM value for display or debug output.
   */
  public formatValue(val: MvmValue, depth = 0): string {
    if (depth > 6) return '...';
    switch (val.kind) {
      case 'void':
        return 'void';
      case 'i64':
        return val.value.toString();
      case 'f64':
        return Number.isInteger(val.value) ? `${val.value}.0` : String(val.value);
      case 'bool':
        return val.value ? 'true' : 'false';
      case 'str':
        return val.value;
      case 'bytes_ref': {
        const b = this.objects[val.id];
        if (b && b.kind === 'bytes') {
          return `Bytes[${b.buffer.length}]`;
        }
        return `<Bytes#${val.id}>`;
      }
      case 'array_ref': {
        const arr = this.objects[val.id];
        if (arr && arr.kind === 'array') {
          return `[${arr.items.map((it) => this.formatValue(it, depth + 1)).join(', ')}]`;
        }
        return `<Array#${val.id}>`;
      }
      case 'map_ref': {
        const m = this.objects[val.id];
        if (m && m.kind === 'map') {
          const pairs: string[] = [];
          for (const [k, v] of m.entries.entries()) {
            pairs.push(`${k}: ${this.formatValue(v, depth + 1)}`);
          }
          return `{${pairs.join(', ')}}`;
        }
        return `<Map#${val.id}>`;
      }
      case 'struct_ref': {
        const s = this.objects[val.id];
        if (s && s.kind === 'struct') {
          return `${s.name} { ${s.fields.map((f) => this.formatValue(f, depth + 1)).join(', ')} }`;
        }
        return `<Struct#${val.id}>`;
      }
      case 'enum_ref': {
        const e = this.objects[val.id];
        if (e && e.kind === 'enum') {
          return e.payload.length === 0
            ? e.variantName
            : `${e.variantName}(${e.payload.map((p) => this.formatValue(p, depth + 1)).join(', ')})`;
        }
        return `<Enum#${val.id}>`;
      }
    }
  }

  /**
   * Deep structural equality comparison between two MVM values.
   */
  public equals(a: MvmValue, b: MvmValue): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case 'void':
        return true;
      case 'i64':
        return a.value === (b as typeof a).value;
      case 'f64':
        return a.value === (b as typeof a).value;
      case 'bool':
        return a.value === (b as typeof a).value;
      case 'str':
        return a.value === (b as typeof a).value;
      case 'bytes_ref': {
        const bA = this.getBytes(a.id);
        const bB = this.getBytes((b as typeof a).id);
        if (bA.buffer.length !== bB.buffer.length) return false;
        for (let i = 0; i < bA.buffer.length; i++) {
          if (bA.buffer[i] !== bB.buffer[i]) return false;
        }
        return true;
      }
      case 'array_ref': {
        const arrA = this.getArray(a.id);
        const arrB = this.getArray((b as typeof a).id);
        if (arrA.items.length !== arrB.items.length) return false;
        for (let i = 0; i < arrA.items.length; i++) {
          if (!this.equals(arrA.items[i], arrB.items[i])) return false;
        }
        return true;
      }
      case 'map_ref': {
        const mapA = this.getMap(a.id);
        const mapB = this.getMap((b as typeof a).id);
        if (mapA.entries.size !== mapB.entries.size) return false;
        for (const [k, valA] of mapA.entries.entries()) {
          const valB = mapB.entries.get(k);
          if (!valB || !this.equals(valA, valB)) return false;
        }
        return true;
      }
      case 'struct_ref': {
        const stA = this.getStruct(a.id);
        const stB = this.getStruct((b as typeof a).id);
        if (stA.structIdx !== stB.structIdx || stA.fields.length !== stB.fields.length) return false;
        for (let i = 0; i < stA.fields.length; i++) {
          if (!this.equals(stA.fields[i], stB.fields[i])) return false;
        }
        return true;
      }
      case 'enum_ref': {
        const enA = this.getEnum(a.id);
        const enB = this.getEnum((b as typeof a).id);
        if (enA.enumIdx !== enB.enumIdx || enA.variantIdx !== enB.variantIdx || enA.payload.length !== enB.payload.length) {
          return false;
        }
        for (let i = 0; i < enA.payload.length; i++) {
          if (!this.equals(enA.payload[i], enB.payload[i])) return false;
        }
        return true;
      }
    }
  }
}
