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
  getTempRoots?(): MvmValue[];
}

export interface GcStatistics {
  collections: number;
  objectsAllocated: number;
  objectsReclaimed: number;
  currentLive: number;
  peakLive: number;
  maxHeapLimit: number;
  allocatedBytes: number;
  peakBytes: number;
  bytesReclaimed: number;
  maxHeapBytes: number;
  gcThresholdObjects: number;
  gcThresholdBytes: number;
}

export const DEFAULT_MAX_HEAP_BYTES = 16 * 1024 * 1024;
const OBJECT_HEADER_BYTES = 32;
const VALUE_SLOT_BYTES = 16;
const MAP_ENTRY_OVERHEAD_BYTES = 32;
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(s: string): number {
  return UTF8_ENCODER.encode(s).length;
}

export function estimateMvmValueBytes(val: MvmValue): number {
  if (val.kind === 'str') {
    return VALUE_SLOT_BYTES + utf8ByteLength(val.value);
  }
  return VALUE_SLOT_BYTES;
}

export function estimateMvmObjectBytes(obj: MvmAllocObject | MvmHeapObject): number {
  let total = OBJECT_HEADER_BYTES;
  switch (obj.kind) {
    case 'array':
      for (const item of obj.items) {
        total += estimateMvmValueBytes(item);
      }
      break;
    case 'map':
      for (const [k, v] of obj.entries.entries()) {
        total += MAP_ENTRY_OVERHEAD_BYTES + utf8ByteLength(k) + estimateMvmValueBytes(v);
      }
      break;
    case 'struct':
      for (const f of obj.fields) {
        total += estimateMvmValueBytes(f);
      }
      break;
    case 'enum':
      for (const p of obj.payload) {
        total += estimateMvmValueBytes(p);
      }
      break;
    case 'bytes':
      total += obj.buffer.length;
      break;
  }
  return total;
}

export class MvmHeapArena {
  private objects: (MvmHeapObject | null)[] = [];
  private objectSizes: number[] = [];
  private freeList: number[] = [];
  private liveCount = 0;
  private peakLive = 0;
  private allocatedBytes = 0;
  private peakBytes = 0;
  private bytesReclaimed = 0;
  private collections = 0;
  private objectsAllocated = 0;
  private objectsReclaimed = 0;
  private gcThresholdObjects: number;
  private gcThresholdBytes: number;

  constructor(
    public readonly maxObjects: number = 65536,
    public readonly maxBytes: number = DEFAULT_MAX_HEAP_BYTES
  ) {
    this.gcThresholdObjects =
      maxObjects === 0 ? 0 : Math.min(maxObjects, Math.max(1, Math.floor(maxObjects / 2)));
    this.gcThresholdBytes =
      maxBytes === 0
        ? 0
        : Math.min(maxBytes, Math.max(OBJECT_HEADER_BYTES, Math.floor(maxBytes / 2)));
  }

  public getLiveCount(): number {
    return this.liveCount;
  }

  public getAllocatedBytes(): number {
    return this.allocatedBytes;
  }

  public getStats(): GcStatistics {
    return {
      collections: this.collections,
      objectsAllocated: this.objectsAllocated,
      objectsReclaimed: this.objectsReclaimed,
      currentLive: this.liveCount,
      peakLive: this.peakLive,
      maxHeapLimit: this.maxObjects,
      allocatedBytes: this.allocatedBytes,
      peakBytes: this.peakBytes,
      bytesReclaimed: this.bytesReclaimed,
      maxHeapBytes: this.maxBytes,
      gcThresholdObjects: this.gcThresholdObjects,
      gcThresholdBytes: this.gcThresholdBytes,
    };
  }

  private updateGcThresholds(): void {
    if (this.maxObjects === 0) {
      this.gcThresholdObjects = 0;
    } else {
      const headroom = Math.max(this.liveCount * 2, this.liveCount + 16);
      this.gcThresholdObjects = Math.min(headroom, this.maxObjects);
    }

    if (this.maxBytes === 0) {
      this.gcThresholdBytes = 0;
    } else {
      const byteHeadroom = Math.max(this.allocatedBytes * 2, this.allocatedBytes + 4096);
      this.gcThresholdBytes = Math.min(byteHeadroom, this.maxBytes);
    }
  }

  private maybeGcBeforeGrowth(growthBytes: number, roots?: RootProvider): void {
    if (!roots) return;
    const hitsHard = this.allocatedBytes + growthBytes > this.maxBytes;
    const hitsSoft = this.allocatedBytes + growthBytes > this.gcThresholdBytes;
    if (hitsHard || hitsSoft) {
      this.collectGarbage(roots);
      this.updateGcThresholds();
    }
  }

  /**
   * Allocates a new heap object. Triggers mark-and-sweep GC at soft/hard thresholds
   * before failing with a controlled object or byte limit error.
   */
  public alloc(obj: MvmAllocObject, roots?: RootProvider): number {
    if (this.maxObjects === 0) {
      throw new Error(`E_MVM_MEMORY_LIMIT: MVM heap limit exceeded (0/0 objects)`);
    }

    const objBytes = estimateMvmObjectBytes(obj);
    if (objBytes > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Heap object requires ${objBytes} bytes, exceeding heap limit (${this.allocatedBytes}/${this.maxBytes} bytes used)`
      );
    }

    if (roots) {
      const hitsHardLimit =
        this.liveCount >= this.maxObjects || this.allocatedBytes + objBytes > this.maxBytes;
      const hitsSoftLimit =
        this.liveCount >= this.gcThresholdObjects ||
        this.allocatedBytes + objBytes > this.gcThresholdBytes;
      if (hitsHardLimit || hitsSoftLimit) {
        this.collectGarbage(roots);
        this.updateGcThresholds();
      }
    }

    if (this.liveCount >= this.maxObjects) {
      throw new Error(
        `E_MVM_MEMORY_LIMIT: MVM heap limit exceeded (${this.liveCount}/${this.maxObjects} objects)`
      );
    }
    if (this.allocatedBytes + objBytes > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Heap byte limit exceeded (requested ${objBytes}, used ${this.allocatedBytes}/${this.maxBytes} bytes)`
      );
    }

    const fullObj: MvmHeapObject = { ...obj, marked: false } as MvmHeapObject;
    let id: number;

    if (this.freeList.length > 0) {
      id = this.freeList.pop()!;
      this.objects[id] = fullObj;
      this.objectSizes[id] = objBytes;
    } else {
      id = this.objects.length;
      this.objects.push(fullObj);
      this.objectSizes.push(objBytes);
    }

    this.liveCount++;
    this.allocatedBytes += objBytes;
    this.objectsAllocated++;
    if (this.liveCount > this.peakLive) {
      this.peakLive = this.liveCount;
    }
    if (this.allocatedBytes > this.peakBytes) {
      this.peakBytes = this.allocatedBytes;
    }

    return id;
  }

  public arrayPush(id: number, val: MvmValue, roots?: RootProvider): void {
    const arr = this.getArray(id);
    const added = estimateMvmValueBytes(val);
    if (added > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Array push requires ${added} bytes, exceeding heap limit (${this.allocatedBytes}/${this.maxBytes} bytes)`
      );
    }
    this.maybeGcBeforeGrowth(added, roots);
    const targetArr = this.getArray(id);
    if (this.allocatedBytes + added > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Array push requires ${added} bytes (${this.allocatedBytes}/${this.maxBytes} bytes used)`
      );
    }
    targetArr.items.push(val);
    this.objectSizes[id] += added;
    this.allocatedBytes += added;
    if (this.allocatedBytes > this.peakBytes) {
      this.peakBytes = this.allocatedBytes;
    }
    void arr;
  }

  public arraySet(id: number, idx: number, val: MvmValue, roots?: RootProvider): void {
    const arr = this.getArray(id);
    if (!Number.isSafeInteger(idx) || idx < 0 || idx >= arr.items.length) {
      throw new Error(
        `E_MVM_OUT_OF_BOUNDS: Array index ${idx} out of bounds (length ${arr.items.length})`
      );
    }
    const oldBytes = estimateMvmValueBytes(arr.items[idx]);
    const newBytes = estimateMvmValueBytes(val);
    const netIncrease = Math.max(0, newBytes - oldBytes);
    if (netIncrease > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Array assignment requires ${netIncrease} additional bytes, exceeding heap limit (${this.allocatedBytes}/${this.maxBytes})`
      );
    }
    if (netIncrease > 0) {
      this.maybeGcBeforeGrowth(netIncrease, roots);
    }
    const nextTotal = this.allocatedBytes - oldBytes + newBytes;
    if (nextTotal > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Array assignment exceeds heap limit (${this.allocatedBytes}/${this.maxBytes})`
      );
    }
    const targetArr = this.getArray(id);
    targetArr.items[idx] = val;
    this.objectSizes[id] = Math.max(OBJECT_HEADER_BYTES, this.objectSizes[id] - oldBytes + newBytes);
    this.allocatedBytes = nextTotal;
    if (this.allocatedBytes > this.peakBytes) {
      this.peakBytes = this.allocatedBytes;
    }
  }

  public mapSet(id: number, key: string, val: MvmValue, roots?: RootProvider): void {
    const m = this.getMap(id);
    const prev = m.entries.get(key);
    const oldBytes = prev !== undefined ? estimateMvmValueBytes(prev) : 0;
    const newBytes =
      prev !== undefined
        ? estimateMvmValueBytes(val)
        : MAP_ENTRY_OVERHEAD_BYTES + utf8ByteLength(key) + estimateMvmValueBytes(val);
    const netIncrease = Math.max(0, newBytes - oldBytes);
    if (netIncrease > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Map insert requires ${netIncrease} additional bytes, exceeding heap limit (${this.allocatedBytes}/${this.maxBytes})`
      );
    }
    if (netIncrease > 0) {
      this.maybeGcBeforeGrowth(netIncrease, roots);
    }
    const nextTotal = this.allocatedBytes - oldBytes + newBytes;
    if (nextTotal > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Map insert exceeds heap limit (${this.allocatedBytes}/${this.maxBytes})`
      );
    }
    const targetMap = this.getMap(id);
    targetMap.entries.set(key, val);
    this.objectSizes[id] = Math.max(OBJECT_HEADER_BYTES, this.objectSizes[id] - oldBytes + newBytes);
    this.allocatedBytes = nextTotal;
    if (this.allocatedBytes > this.peakBytes) {
      this.peakBytes = this.allocatedBytes;
    }
  }

  public fieldSet(id: number, fieldIdx: number, val: MvmValue, roots?: RootProvider): void {
    const st = this.getStruct(id);
    if (fieldIdx < 0 || fieldIdx >= st.fields.length) {
      throw new Error(
        `E_MVM_OUT_OF_BOUNDS: Field index ${fieldIdx} out of bounds on struct '${st.name}'`
      );
    }
    const oldBytes = estimateMvmValueBytes(st.fields[fieldIdx]);
    const newBytes = estimateMvmValueBytes(val);
    const netIncrease = Math.max(0, newBytes - oldBytes);
    if (netIncrease > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Struct field assignment requires ${netIncrease} additional bytes, exceeding heap limit (${this.allocatedBytes}/${this.maxBytes})`
      );
    }
    if (netIncrease > 0) {
      this.maybeGcBeforeGrowth(netIncrease, roots);
    }
    const nextTotal = this.allocatedBytes - oldBytes + newBytes;
    if (nextTotal > this.maxBytes) {
      throw new Error(
        `E_MVM_HEAP_BYTES_LIMIT: Struct field assignment exceeds heap limit (${this.allocatedBytes}/${this.maxBytes})`
      );
    }
    const targetSt = this.getStruct(id);
    targetSt.fields[fieldIdx] = val;
    this.objectSizes[id] = Math.max(OBJECT_HEADER_BYTES, this.objectSizes[id] - oldBytes + newBytes);
    this.allocatedBytes = nextTotal;
    if (this.allocatedBytes > this.peakBytes) {
      this.peakBytes = this.allocatedBytes;
    }
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
   * Iterative, cycle-safe Mark-and-Sweep garbage collection:
   * 1. Mark phase: Scans operand stack, globals, active call-frame locals, and transient temp roots.
   * 2. Sweep phase: Reclaims unmarked slots into freeList and updates byte/object accounting.
   */
  public collectGarbage(roots: RootProvider): { reclaimed: number; liveAfter: number } {
    this.collections++;

    const worklist: number[] = [];
    const enqueue = (val: MvmValue): void => {
      let refId: number;
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
      if (refId < 0 || refId >= this.objects.length) return;
      const obj = this.objects[refId];
      if (!obj || obj.marked) return;
      obj.marked = true;
      worklist.push(refId);
    };

    for (const v of roots.getStackRoots()) enqueue(v);
    for (const v of roots.getGlobalRoots()) enqueue(v);
    for (const v of roots.getFrameRoots()) enqueue(v);
    if (roots.getTempRoots) {
      for (const v of roots.getTempRoots()) enqueue(v);
    }

    while (worklist.length > 0) {
      const id = worklist.pop()!;
      const obj = this.objects[id];
      if (!obj) continue;
      switch (obj.kind) {
        case 'array':
          for (const item of obj.items) enqueue(item);
          break;
        case 'map':
          for (const item of obj.entries.values()) enqueue(item);
          break;
        case 'struct':
          for (const field of obj.fields) enqueue(field);
          break;
        case 'enum':
          for (const arg of obj.payload) enqueue(arg);
          break;
        case 'bytes':
          break;
      }
    }

    // 2. Sweep Phase
    let reclaimed = 0;
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj === null) continue;

      if (!obj.marked) {
        const reclaimedSize = this.objectSizes[i] || 0;
        this.objects[i] = null;
        this.objectSizes[i] = 0;
        this.freeList.push(i);
        this.liveCount--;
        this.allocatedBytes = Math.max(0, this.allocatedBytes - reclaimedSize);
        this.objectsReclaimed++;
        this.bytesReclaimed += reclaimedSize;
        reclaimed++;
      } else {
        obj.marked = false;
      }
    }

    return { reclaimed, liveAfter: this.liveCount };
  }

  /**
   * Formats an MVM value for display or debug output without diverging on cycles.
   */
  public formatValue(val: MvmValue, depth = 0, activeIds: Set<number> = new Set()): string {
    if (depth > 16) return '...';
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
        if (activeIds.has(val.id)) return `<Cycle#Array${val.id}>`;
        const arr = this.objects[val.id];
        if (arr && arr.kind === 'array') {
          activeIds.add(val.id);
          const formatted = `[${arr.items.map((it) => this.formatValue(it, depth + 1, activeIds)).join(', ')}]`;
          activeIds.delete(val.id);
          return formatted;
        }
        return `<Array#${val.id}>`;
      }
      case 'map_ref': {
        if (activeIds.has(val.id)) return `<Cycle#Map${val.id}>`;
        const m = this.objects[val.id];
        if (m && m.kind === 'map') {
          activeIds.add(val.id);
          const pairs: string[] = [];
          for (const [k, v] of m.entries.entries()) {
            pairs.push(`${k}: ${this.formatValue(v, depth + 1, activeIds)}`);
          }
          activeIds.delete(val.id);
          return `{${pairs.join(', ')}}`;
        }
        return `<Map#${val.id}>`;
      }
      case 'struct_ref': {
        if (activeIds.has(val.id)) return `<Cycle#Struct${val.id}>`;
        const s = this.objects[val.id];
        if (s && s.kind === 'struct') {
          activeIds.add(val.id);
          const formatted = `${s.name} { ${s.fields.map((f) => this.formatValue(f, depth + 1, activeIds)).join(', ')} }`;
          activeIds.delete(val.id);
          return formatted;
        }
        return `<Struct#${val.id}>`;
      }
      case 'enum_ref': {
        if (activeIds.has(val.id)) return `<Cycle#Enum${val.id}>`;
        const e = this.objects[val.id];
        if (e && e.kind === 'enum') {
          activeIds.add(val.id);
          const formatted =
            e.payload.length === 0
              ? e.variantName
              : `${e.variantName}(${e.payload.map((p) => this.formatValue(p, depth + 1, activeIds)).join(', ')})`;
          activeIds.delete(val.id);
          return formatted;
        }
        return `<Enum#${val.id}>`;
      }
    }
  }

  /**
   * Coinductive, cycle-safe deep structural equality comparison between two MVM values.
   */
  public equals(a: MvmValue, b: MvmValue): boolean {
    const worklist: Array<{ left: MvmValue; right: MvmValue }> = [{ left: a, right: b }];
    const visitedPairs = new Set<string>();

    while (worklist.length > 0) {
      const { left, right } = worklist.pop()!;
      if (left.kind !== right.kind) return false;

      switch (left.kind) {
        case 'void':
          break;
        case 'i64':
          if (left.value !== (right as typeof left).value) return false;
          break;
        case 'f64':
          if (left.value !== (right as typeof left).value) return false;
          break;
        case 'bool':
          if (left.value !== (right as typeof left).value) return false;
          break;
        case 'str':
          if (left.value !== (right as typeof left).value) return false;
          break;
        case 'bytes_ref': {
          const idA = left.id;
          const idB = (right as typeof left).id;
          const bA = this.getBytes(idA);
          const bB = this.getBytes(idB);
          if (idA === idB) break;
          if (bA.buffer.length !== bB.buffer.length) return false;
          for (let i = 0; i < bA.buffer.length; i++) {
            if (bA.buffer[i] !== bB.buffer[i]) return false;
          }
          break;
        }
        case 'array_ref': {
          const idA = left.id;
          const idB = (right as typeof left).id;
          const arrA = this.getArray(idA);
          const arrB = this.getArray(idB);
          if (idA === idB) break;
          const pairKey = `a:${idA}:${idB}`;
          if (visitedPairs.has(pairKey)) break;
          visitedPairs.add(pairKey);
          if (arrA.items.length !== arrB.items.length) return false;
          for (let i = 0; i < arrA.items.length; i++) {
            worklist.push({ left: arrA.items[i], right: arrB.items[i] });
          }
          break;
        }
        case 'map_ref': {
          const idA = left.id;
          const idB = (right as typeof left).id;
          const mapA = this.getMap(idA);
          const mapB = this.getMap(idB);
          if (idA === idB) break;
          const pairKey = `m:${idA}:${idB}`;
          if (visitedPairs.has(pairKey)) break;
          visitedPairs.add(pairKey);
          if (mapA.entries.size !== mapB.entries.size) return false;
          for (const [k, valA] of mapA.entries.entries()) {
            if (!mapB.entries.has(k)) return false;
            worklist.push({ left: valA, right: mapB.entries.get(k)! });
          }
          break;
        }
        case 'struct_ref': {
          const idA = left.id;
          const idB = (right as typeof left).id;
          const stA = this.getStruct(idA);
          const stB = this.getStruct(idB);
          if (idA === idB) break;
          const pairKey = `s:${idA}:${idB}`;
          if (visitedPairs.has(pairKey)) break;
          visitedPairs.add(pairKey);
          if (stA.structIdx !== stB.structIdx || stA.fields.length !== stB.fields.length) {
            return false;
          }
          for (let i = 0; i < stA.fields.length; i++) {
            worklist.push({ left: stA.fields[i], right: stB.fields[i] });
          }
          break;
        }
        case 'enum_ref': {
          const idA = left.id;
          const idB = (right as typeof left).id;
          const enA = this.getEnum(idA);
          const enB = this.getEnum(idB);
          if (idA === idB) break;
          const pairKey = `e:${idA}:${idB}`;
          if (visitedPairs.has(pairKey)) break;
          visitedPairs.add(pairKey);
          if (
            enA.enumIdx !== enB.enumIdx ||
            enA.variantIdx !== enB.variantIdx ||
            enA.payload.length !== enB.payload.length
          ) {
            return false;
          }
          for (let i = 0; i < enA.payload.length; i++) {
            worklist.push({ left: enA.payload[i], right: enB.payload[i] });
          }
          break;
        }
      }
    }
    return true;
  }
}
