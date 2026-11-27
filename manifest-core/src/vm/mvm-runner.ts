import {
  MVM_WASM_BASE64,
  MVM_WASM_BYTE_LENGTH,
  MVM_WASM_SHA256,
} from './mvm-wasm-bytes.ts';
import { MvmInterpreter } from './mvm-interpreter.ts';

export const MAX_WASM_MBC_BYTES = 8 * 1024 * 1024;
export const MAX_WASM_CFG_BYTES = 256 * 1024;
export const MAX_WASM_HOST_IO_BYTES = 1024 * 1024;
export const MAX_WASM_COMPILER_IO_BYTES = 8 * 1024 * 1024;
export const WASM_HOST_PROTOCOL_V2_HEADER = 'MVMHOST2';

export interface MvmExecutionOptions {
  grantedCapabilities?: string[];
  maxSteps?: number;
  maxCallDepth?: number;
  maxHeapObjects?: number;
  maxHeapBytes?: number;
  entryFunction?: string;
  virtualFiles?: Record<string, string>;
  onConsoleLog?: (line: string) => void;
  networkHandler?: (url: string) => string;
  dbHandler?: (query: string) => string;
}

export interface MvmVerificationResponse {
  ok: boolean;
  moduleName?: string;
  functions?: number;
  constants?: number;
  imports?: number;
  error?: string;
}

export interface MvmDisassemblyResponse {
  ok: boolean;
  verified?: boolean;
  disassembly?: string;
  error?: string;
}

export interface MvmWasmGcStats {
  collections: number;
  objectsAllocated: number;
  objectsReclaimed: number;
  liveObjects: number;
  allocatedBytes: number;
  peakLive: number;
  peakBytes: number;
  bytesReclaimed: number;
}

export interface MvmWasmEngineInfo {
  ok: boolean;
  name: string;
  version: string;
  protocolVersion: number;
  abi: string;
  compilerEngine?: string;
  compilerVersion?: string;
  compilerAbiVersion?: number;
  features: string[];
  sha256: string;
  byteLength: number;
}

export interface MvmExecutionResponse {
  ok: boolean;
  phase?: 'decode' | 'verify' | 'runtime';
  returnType: string;
  returnValue: string;
  stdout: string[];
  steps: number;
  heapObjects: number;
  heapObjectsAllocated?: number;
  gcStats?: MvmWasmGcStats;
  errorCode?: string;
  error?: string;
  virtualFiles: Record<string, string>;
}

export interface DecodedWasmHostRequest {
  protocolVersion: 1 | 2;
  symbol: string;
  capability: string;
  args: string[];
}

export interface WasmHostResponse {
  ok: boolean;
  payload: string;
  tag?: 'void' | 'i64' | 'f64' | 'bool' | 'str' | 'err';
  value?: string;
}

export interface MvmWasmExports {
  memory: WebAssembly.Memory;
  mvm_alloc: (len: number) => number;
  mvm_dealloc: (ptr: number, len: number) => void;
  mvm_output_ptr: () => number;
  mvm_output_len: () => number;
  mvm_set_host_response: (ptr: number, len: number) => void;
  mvm_engine_info?: () => number;
  mvm_check_source?: (reqPtr: number, reqLen: number) => number;
  mvm_compile_source?: (reqPtr: number, reqLen: number) => number;
  mvm_inspect_ir?: (reqPtr: number, reqLen: number) => number;
  mvm_verify: (mbcPtr: number, mbcLen: number) => number;
  mvm_disassemble: (mbcPtr: number, mbcLen: number) => number;
  mvm_execute: (mbcPtr: number, mbcLen: number, cfgPtr: number, cfgLen: number) => number;
}

let cachedWasmModulePromise: Promise<WebAssembly.Module> | null = null;
let cachedCompilerExportsPromise: Promise<MvmWasmExports> | null = null;

function decodeBase64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function getCompiledRustMvmModule(): Promise<WebAssembly.Module> {
  if (!cachedWasmModulePromise) {
    const wasmBytes = decodeBase64ToBytes(MVM_WASM_BASE64);
    cachedWasmModulePromise = WebAssembly.compile(wasmBytes as BufferSource);
  }
  return cachedWasmModulePromise;
}

/**
 * Validates that `[ptr, ptr + len)` lies safely within `memory.buffer` without overflow or negative/non-integer bounds.
 */
export function validateWasmMemoryRange(
  memory: Pick<WebAssembly.Memory, 'buffer'>,
  ptr: number,
  len: number,
  maxLen: number
): void {
  if (!Number.isSafeInteger(len) || len < 0 || len > maxLen) {
    throw new Error(`WASM FFI range error: length ${len} exceeds bounds [0, ${maxLen}]`);
  }
  if (!Number.isSafeInteger(ptr) || ptr < 0) {
    throw new Error(`WASM FFI range error: invalid pointer ${ptr}`);
  }
  if (len === 0) {
    return;
  }
  if (ptr === 0) {
    throw new Error('WASM FFI range error: null pointer with non-zero length');
  }
  const byteLength = memory.buffer.byteLength;
  const end = ptr + len;
  if (!Number.isSafeInteger(end) || end > byteLength) {
    throw new Error(
      `WASM FFI range error: slice [${ptr}, ${end}) exceeds linear memory (${byteLength} bytes)`
    );
  }
}

export function readValidatedWasmBytes(
  memory: Pick<WebAssembly.Memory, 'buffer'>,
  ptr: number,
  len: number,
  maxLen: number
): Uint8Array {
  validateWasmMemoryRange(memory, ptr, len, maxLen);
  if (len === 0) {
    return new Uint8Array(0);
  }
  // Always copy out immediately in case subsequent WASM calls trigger memory.grow()
  return new Uint8Array(memory.buffer, ptr, len).slice();
}

export function writeValidatedWasmBytes(
  exports: MvmWasmExports,
  bytes: Uint8Array,
  maxLen: number
): { ptr: number; allocLen: number } {
  if (bytes.length > maxLen) {
    throw new Error(`WASM FFI write error: payload (${bytes.length} B) exceeds limit (${maxLen} B)`);
  }
  const allocLen = Math.max(1, bytes.length);
  const ptr = exports.mvm_alloc(allocLen);
  if (!Number.isSafeInteger(ptr) || ptr <= 0) {
    throw new Error(`WASM FFI allocation failed for ${allocLen} bytes`);
  }
  // Re-read exports.memory.buffer AFTER mvm_alloc in case linear memory grew
  validateWasmMemoryRange(exports.memory, ptr, bytes.length, maxLen);
  if (bytes.length > 0) {
    new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  }
  return { ptr, allocLen };
}

/**
 * Symmetric protocol field encoder matching `mvm-wasm` `encode_protocol_field`.
 */
export function encodeProtocolField(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === ':') out += '\\c';
    else if (ch === '|') out += '\\p';
    else if (ch === '%') out += '\\x25';
    else if (ch === '"') out += '\\"';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}

/**
 * Strict symmetric protocol field decoder rejecting malformed or truncated escape sequences.
 */
export function decodeProtocolField(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 >= raw.length) {
      throw new Error('Truncated escape sequence at end of WASM host protocol field');
    }
    const esc = raw[++i];
    switch (esc) {
      case '\\':
        out += '\\';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'c':
        out += ':';
        break;
      case 'p':
        out += '|';
        break;
      case '"':
        out += '"';
        break;
      case 'x': {
        if (i + 2 >= raw.length) {
          throw new Error('Truncated \\x hex escape in WASM host protocol field');
        }
        const hex = raw.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new Error(`Invalid \\x hex escape '\\x${hex}'`);
        }
        i += 2;
        out += String.fromCharCode(parseInt(hex, 16));
        break;
      }
      case 'u': {
        if (i + 4 >= raw.length) {
          throw new Error('Truncated \\u unicode escape in WASM host protocol field');
        }
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new Error(`Invalid \\u hex escape '\\u${hex}'`);
        }
        i += 4;
        out += String.fromCharCode(parseInt(hex, 16));
        break;
      }
      default:
        throw new Error(`Unsupported escape sequence '\\${esc}' in WASM host protocol field`);
    }
  }
  return out;
}

function unescapeLegacyHostArg(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    throw new Error('Malformed legacy escaped host argument');
  }
}

export function encodeWasmHostRequestV2(
  symbol: string,
  capability: string,
  args: Array<{ tag: 'void' | 'i64' | 'f64' | 'bool' | 'str'; value?: string }>
): string {
  const lines = [
    WASM_HOST_PROTOCOL_V2_HEADER,
    encodeProtocolField(symbol),
    encodeProtocolField(capability),
  ];
  for (const arg of args) {
    if (arg.tag === 'void') {
      lines.push('void:');
    } else if (arg.tag === 'str') {
      lines.push(`str:${encodeProtocolField(arg.value ?? '')}`);
    } else {
      lines.push(`${arg.tag}:${arg.value ?? ''}`);
    }
  }
  return lines.join('\n');
}

export function decodeWasmHostRequest(rawText: string): DecodedWasmHostRequest {
  if (typeof rawText !== 'string' || rawText.length === 0) {
    throw new Error('Empty WASM host call request');
  }
  if (rawText.length > MAX_WASM_HOST_IO_BYTES) {
    throw new Error('WASM host call request exceeds maximum payload size');
  }

  const lines = rawText.split('\n');
  if (lines[0] === WASM_HOST_PROTOCOL_V2_HEADER) {
    if (lines.length < 3) {
      throw new Error('Malformed MVMHOST2 request frame: missing symbol or capability');
    }
    const symbol = decodeProtocolField(lines[1]);
    const capability = decodeProtocolField(lines[2]);
    const args: string[] = [];
    for (let i = 3; i < lines.length; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) {
        throw new Error(`Malformed MVMHOST2 argument line at index ${i}`);
      }
      const tag = line.slice(0, colonIdx);
      const rest = line.slice(colonIdx + 1);
      if (tag === 'str') {
        args.push(decodeProtocolField(rest));
      } else if (tag === 'void' || tag === 'i64' || tag === 'f64' || tag === 'bool') {
        args.push(rest);
      } else {
        throw new Error(`Unsupported MVMHOST2 argument tag '${tag}'`);
      }
    }
    return { protocolVersion: 2, symbol, capability, args };
  }

  // Legacy v1 compatibility for prebuilt `MVM_WASM_BASE64`
  if (lines.length < 2) {
    throw new Error('Malformed legacy host request frame');
  }
  const symbol = lines[0];
  const capability = lines[1];
  const args = lines.slice(2).map((line) => {
    const idx = line.indexOf(':');
    if (idx < 0) {
      throw new Error('Malformed legacy host argument line');
    }
    const tag = line.slice(0, idx);
    const rest = line.slice(idx + 1);
    return tag === 'str' ? unescapeLegacyHostArg(rest) : rest;
  });
  return { protocolVersion: 1, symbol, capability, args };
}

export function encodeWasmHostResponse(
  protocolVersion: 1 | 2,
  res: WasmHostResponse
): string {
  if (protocolVersion === 2) {
    if (!res.ok) {
      return `err:${encodeProtocolField(res.value ?? res.payload)}`;
    }
    const tag = res.tag || 'str';
    if (tag === 'void') return 'void:';
    if (tag === 'str') return `str:${encodeProtocolField(res.value ?? '')}`;
    return `${tag}:${res.value ?? ''}`;
  }
  return res.payload;
}

const KNOWN_HOST_SYMBOLS = new Set([
  'console.print',
  'print',
  'println',
  'std::io::print',
  'std::io::println',
  'time.now',
  'std::time::now',
  'fs.read_text',
  'std::fs::read_text',
  'fs.write_text',
  'std::fs::write_text',
  'net.get',
  'std::net::get',
  'fetch',
  'db.query',
  'std::db::query',
]);

async function instantiateMvm(
  hostDispatch?: (
    symbol: string,
    capability: string,
    args: string[]
  ) => WasmHostResponse
): Promise<MvmWasmExports> {
  const mod = await getCompiledRustMvmModule();
  let exportsRef: MvmWasmExports | null = null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();

  const instance = await WebAssembly.instantiate(mod, {
    env: {
      mvm_host_call: (reqPtr: number, reqLen: number): number => {
        if (!exportsRef) return 0;
        let protocolVersion: 1 | 2 = 1;
        let res: WasmHostResponse;

        try {
          const reqBytes = readValidatedWasmBytes(
            exportsRef.memory,
            reqPtr,
            reqLen,
            MAX_WASM_HOST_IO_BYTES
          );
          const text = decoder.decode(reqBytes);
          const decoded = decodeWasmHostRequest(text);
          protocolVersion = decoded.protocolVersion;

          if (!KNOWN_HOST_SYMBOLS.has(decoded.symbol)) {
            res = {
              ok: false,
              tag: 'err',
              value: `Unsupported host symbol '${decoded.symbol}'`,
              payload: `Unsupported host symbol '${decoded.symbol}'`,
            };
          } else {
            res = hostDispatch
              ? hostDispatch(decoded.symbol, decoded.capability, decoded.args)
              : { ok: true, tag: 'void', value: '', payload: 'void:' };
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          res = {
            ok: false,
            tag: 'err',
            value: msg,
            payload: msg,
          };
        }

        const encodedPayload = encodeWasmHostResponse(protocolVersion, res);
        const respBytes = encoder.encode(encodedPayload);
        if (respBytes.length > MAX_WASM_HOST_IO_BYTES) {
          const errBytes = encoder.encode('err:Host response exceeded maximum payload size');
          const { ptr: errPtr, allocLen: errAlloc } = writeValidatedWasmBytes(
            exportsRef,
            errBytes,
            MAX_WASM_HOST_IO_BYTES
          );
          try {
            exportsRef.mvm_set_host_response(errPtr, errBytes.length);
          } finally {
            exportsRef.mvm_dealloc(errPtr, errAlloc);
          }
          return 0;
        }

        const { ptr: respPtr, allocLen } = writeValidatedWasmBytes(
          exportsRef,
          respBytes,
          MAX_WASM_HOST_IO_BYTES
        );
        try {
          exportsRef.mvm_set_host_response(respPtr, respBytes.length);
        } finally {
          exportsRef.mvm_dealloc(respPtr, allocLen);
        }
        return res.ok ? 1 : 0;
      },
    },
  });

  exportsRef = instance.exports as unknown as MvmWasmExports;
  return exportsRef;
}

export async function getCompilerWasmExports(): Promise<MvmWasmExports> {
  if (!cachedCompilerExportsPromise) {
    cachedCompilerExportsPromise = instantiateMvm();
  }
  return cachedCompilerExportsPromise;
}

export function readOutputJson<T>(
  exports: MvmWasmExports,
  maxLen: number = MAX_WASM_HOST_IO_BYTES
): T {
  const ptr = exports.mvm_output_ptr();
  const len = exports.mvm_output_len();
  const slice = readValidatedWasmBytes(exports.memory, ptr, len, maxLen);
  const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(slice);
  if (!jsonText) {
    throw new Error('WASM MVM returned empty output buffer');
  }
  return JSON.parse(jsonText) as T;
}

/**
 * Inspects engine identity, ABI version, supported features, and bundled artifact hash
 * of the compiled Rust MVM WASM engine (`mvm-wasm`).
 */
export async function getRustMvmEngineInfo(): Promise<MvmWasmEngineInfo> {
  const exports = await instantiateMvm();
  if (typeof exports.mvm_engine_info !== 'function') {
    throw new Error('WASM MVM artifact does not export mvm_engine_info');
  }
  exports.mvm_engine_info();
  const parsed = readOutputJson<Omit<MvmWasmEngineInfo, 'sha256' | 'byteLength'>>(exports);
  return {
    ...parsed,
    sha256: MVM_WASM_SHA256,
    byteLength: MVM_WASM_BYTE_LENGTH,
  };
}

/**
 * Verifies `.mbc` bytecode inside the compiled Rust Manifest Virtual Machine (`mvm-core`).
 */
export async function verifyMbcInRustVm(mbcBytes: Uint8Array): Promise<MvmVerificationResponse> {
  if (!(mbcBytes instanceof Uint8Array) || mbcBytes.length === 0) {
    return { ok: false, error: 'MBC bytecode buffer must be non-empty' };
  }
  const exports = await instantiateMvm();
  const { ptr, allocLen } = writeValidatedWasmBytes(exports, mbcBytes, MAX_WASM_MBC_BYTES);
  try {
    exports.mvm_verify(ptr, mbcBytes.length);
    return readOutputJson<MvmVerificationResponse>(exports);
  } finally {
    exports.mvm_dealloc(ptr, allocLen);
  }
}

/**
 * Disassembles `.mbc` bytecode using the compiled Rust Manifest Virtual Machine (`mvm-core`).
 */
export async function disassembleMbcInRustVm(
  mbcBytes: Uint8Array
): Promise<MvmDisassemblyResponse> {
  if (!(mbcBytes instanceof Uint8Array) || mbcBytes.length === 0) {
    return { ok: false, error: 'MBC bytecode buffer must be non-empty' };
  }
  const exports = await instantiateMvm();
  const { ptr, allocLen } = writeValidatedWasmBytes(exports, mbcBytes, MAX_WASM_MBC_BYTES);
  try {
    exports.mvm_disassemble(ptr, mbcBytes.length);
    return readOutputJson<MvmDisassemblyResponse>(exports);
  } finally {
    exports.mvm_dealloc(ptr, allocLen);
  }
}

/**
 * Verifies and executes `.mbc` bytecode inside the compiled Rust Manifest Virtual Machine (`mvm-core`),
 * enforcing capability grants, deterministic instruction step limits, and bounded memory.
 */
export async function executeMbcInRustVm(
  mbcBytes: Uint8Array,
  options: MvmExecutionOptions = {}
): Promise<MvmExecutionResponse> {
  if (!(mbcBytes instanceof Uint8Array) || mbcBytes.length === 0) {
    return {
      ok: false,
      phase: 'decode',
      returnType: 'void',
      returnValue: 'void',
      stdout: [],
      steps: 0,
      heapObjects: 0,
      error: 'MBC bytecode buffer must be non-empty',
      virtualFiles: { ...(options.virtualFiles || {}) },
    };
  }

  const granted = options.grantedCapabilities ?? ['console'];
  const vfs: Record<string, string> = { ...(options.virtualFiles || {}) };

  const exports = await instantiateMvm((symbol, _capability, args): WasmHostResponse => {
    switch (symbol) {
      case 'console.print':
      case 'print':
      case 'println':
      case 'std::io::print':
      case 'std::io::println': {
        if (options.onConsoleLog) {
          options.onConsoleLog(args.join(' '));
        }
        return { ok: true, tag: 'void', value: '', payload: 'void:' };
      }
      case 'time.now':
      case 'std::time::now': {
        const now = String(Date.now());
        return { ok: true, tag: 'i64', value: now, payload: `i64:${now}` };
      }
      case 'fs.read_text':
      case 'std::fs::read_text': {
        const path = args[0] || '';
        if (!(path in vfs)) {
          const msg = `File '${path}' not found in workspace`;
          return { ok: false, tag: 'err', value: msg, payload: msg };
        }
        return { ok: true, tag: 'str', value: vfs[path], payload: `str:${vfs[path]}` };
      }
      case 'fs.write_text':
      case 'std::fs::write_text': {
        const path = args[0] || '';
        const content = args[1] ?? '';
        vfs[path] = content;
        return { ok: true, tag: 'bool', value: 'true', payload: 'bool:true' };
      }
      case 'net.get':
      case 'std::net::get':
      case 'fetch': {
        const url = args[0] || '';
        if (options.networkHandler) {
          const out = String(options.networkHandler(url));
          return { ok: true, tag: 'str', value: out, payload: `str:${out}` };
        }
        const msg = `Synchronous network access to '${url}' blocked by sandbox policy unless an explicit host network adapter is configured`;
        return { ok: false, tag: 'err', value: msg, payload: msg };
      }
      case 'db.query':
      case 'std::db::query': {
        const q = args[0] || '';
        if (options.dbHandler) {
          const out = String(options.dbHandler(q));
          return { ok: true, tag: 'str', value: out, payload: `str:${out}` };
        }
        return { ok: true, tag: 'str', value: '[]', payload: 'str:[]' };
      }
      default: {
        const msg = `Unsupported host symbol '${symbol}'`;
        return { ok: false, tag: 'err', value: msg, payload: msg };
      }
    }
  });

  const cfgLines: string[] = [];
  if (options.maxSteps !== undefined) cfgLines.push(`MAX_STEPS=${options.maxSteps}`);
  if (options.maxCallDepth !== undefined) cfgLines.push(`MAX_DEPTH=${options.maxCallDepth}`);
  if (options.maxHeapObjects !== undefined) cfgLines.push(`MAX_HEAP=${options.maxHeapObjects}`);
  if (options.maxHeapBytes !== undefined) cfgLines.push(`MAX_HEAP_BYTES=${options.maxHeapBytes}`);
  if (options.entryFunction) cfgLines.push(`ENTRY=${options.entryFunction}`);
  for (const cap of granted) {
    cfgLines.push(`GRANT=${cap}`);
  }
  const cfgBytes = new TextEncoder().encode(cfgLines.join('\n'));

  const { ptr: mbcPtr, allocLen: mbcAlloc } = writeValidatedWasmBytes(
    exports,
    mbcBytes,
    MAX_WASM_MBC_BYTES
  );
  const { ptr: cfgPtr, allocLen: cfgAlloc } = writeValidatedWasmBytes(
    exports,
    cfgBytes,
    MAX_WASM_CFG_BYTES
  );

  try {
    exports.mvm_execute(mbcPtr, mbcBytes.length, cfgPtr, cfgBytes.length);

    const parsed = readOutputJson<{
      ok: boolean;
      phase?: 'decode' | 'verify' | 'runtime';
      returnType?: string;
      returnValue?: string;
      stdout?: string[];
      steps?: number;
      heapObjects?: number;
      heapObjectsAllocated?: number;
      gcStats?: MvmWasmGcStats;
      errorCode?: string;
      error?: string;
    }>(exports);

    return {
      ok: parsed.ok,
      phase: parsed.phase,
      returnType: parsed.returnType || 'void',
      returnValue: parsed.returnValue ?? 'void',
      stdout: parsed.stdout || [],
      steps: parsed.steps ?? 0,
      heapObjects: parsed.heapObjects ?? 0,
      heapObjectsAllocated: parsed.heapObjectsAllocated,
      gcStats: parsed.gcStats,
      errorCode: parsed.errorCode,
      error: parsed.error,
      virtualFiles: vfs,
    };
  } finally {
    exports.mvm_dealloc(mbcPtr, mbcAlloc);
    exports.mvm_dealloc(cfgPtr, cfgAlloc);
  }
}

/**
 * Executes `.mbc` bytecode using the managed MVM bytecode interpreter
 * with full Mark-and-Sweep garbage collection, fuel limits, and capability gates.
 */
export function executeMbcDirect(
  mbcBytes: Uint8Array,
  options: MvmExecutionOptions = {}
): MvmExecutionResponse {
  const res = MvmInterpreter.execute(mbcBytes, options);
  const matchedCode = res.error?.match(/^\[(E_MVM_[A-Z0-9_]+)\]/);
  return {
    ok: res.ok,
    phase: res.phase,
    returnType: res.returnType,
    returnValue: res.returnValue,
    stdout: res.stdout,
    steps: res.steps,
    heapObjects: res.heapObjects,
    heapObjectsAllocated: res.gcStats.objectsAllocated,
    gcStats: {
      collections: res.gcStats.collections,
      objectsAllocated: res.gcStats.objectsAllocated,
      objectsReclaimed: res.gcStats.objectsReclaimed,
      liveObjects: res.gcStats.currentLive,
      allocatedBytes: res.gcStats.allocatedBytes,
      peakLive: res.gcStats.peakLive,
      peakBytes: res.gcStats.peakBytes,
      bytesReclaimed: res.gcStats.bytesReclaimed,
    },
    errorCode: matchedCode ? matchedCode[1] : undefined,
    error: res.error,
    virtualFiles: res.virtualFiles,
  };
}
