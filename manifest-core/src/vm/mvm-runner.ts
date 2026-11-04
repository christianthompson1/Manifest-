import { MVM_WASM_BASE64 } from './mvm-wasm-bytes.ts';

export interface MvmExecutionOptions {
  grantedCapabilities?: string[];
  maxSteps?: number;
  maxCallDepth?: number;
  maxHeapObjects?: number;
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

export interface MvmExecutionResponse {
  ok: boolean;
  phase?: 'decode' | 'verify' | 'runtime';
  returnType: string;
  returnValue: string;
  stdout: string[];
  steps: number;
  heapObjects: number;
  error?: string;
  virtualFiles: Record<string, string>;
}

interface MvmWasmExports {
  memory: WebAssembly.Memory;
  mvm_alloc: (len: number) => number;
  mvm_dealloc: (ptr: number, len: number) => void;
  mvm_output_ptr: () => number;
  mvm_output_len: () => number;
  mvm_set_host_response: (ptr: number, len: number) => void;
  mvm_verify: (mbcPtr: number, mbcLen: number) => number;
  mvm_disassemble: (mbcPtr: number, mbcLen: number) => number;
  mvm_execute: (mbcPtr: number, mbcLen: number, cfgPtr: number, cfgLen: number) => number;
}

let cachedWasmModulePromise: Promise<WebAssembly.Module> | null = null;

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

async function getCompiledRustMvmModule(): Promise<WebAssembly.Module> {
  if (!cachedWasmModulePromise) {
    const wasmBytes = decodeBase64ToBytes(MVM_WASM_BASE64);
    cachedWasmModulePromise = WebAssembly.compile(wasmBytes as BufferSource);
  }
  return cachedWasmModulePromise;
}

function unescapeHostArg(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

async function instantiateMvm(
  hostDispatch?: (symbol: string, capability: string, args: string[]) => { ok: boolean; payload: string }
): Promise<MvmWasmExports> {
  const mod = await getCompiledRustMvmModule();
  let exportsRef: MvmWasmExports | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const instance = await WebAssembly.instantiate(mod, {
    env: {
      mvm_host_call: (reqPtr: number, reqLen: number): number => {
        if (!exportsRef) return 0;
        const mem = new Uint8Array(exportsRef.memory.buffer, reqPtr, reqLen);
        const text = decoder.decode(mem);
        const lines = text.split('\n');
        const symbol = lines[0] || '';
        const capability = lines[1] || '';
        const parsedArgs = lines.slice(2).map((line) => {
          const idx = line.indexOf(':');
          if (idx < 0) return '';
          const tag = line.slice(0, idx);
          const rest = line.slice(idx + 1);
          return tag === 'str' ? unescapeHostArg(rest) : rest;
        });

        const res = hostDispatch
          ? hostDispatch(symbol, capability, parsedArgs)
          : { ok: true, payload: 'void:' };

        const respBytes = encoder.encode(res.payload);
        const respPtr = exportsRef.mvm_alloc(Math.max(1, respBytes.length));
        new Uint8Array(exportsRef.memory.buffer, respPtr, respBytes.length).set(respBytes);
        exportsRef.mvm_set_host_response(respPtr, respBytes.length);
        exportsRef.mvm_dealloc(respPtr, Math.max(1, respBytes.length));
        return res.ok ? 1 : 0;
      },
    },
  });

  exportsRef = instance.exports as unknown as MvmWasmExports;
  return exportsRef;
}

function readOutputJson<T>(exports: MvmWasmExports): T {
  const ptr = exports.mvm_output_ptr();
  const len = exports.mvm_output_len();
  const slice = new Uint8Array(exports.memory.buffer, ptr, len);
  const jsonText = new TextDecoder().decode(slice);
  return JSON.parse(jsonText) as T;
}

/**
 * Verifies `.mbc` bytecode inside the compiled Rust Manifest Virtual Machine (`mvm-core`).
 */
export async function verifyMbcInRustVm(mbcBytes: Uint8Array): Promise<MvmVerificationResponse> {
  const exports = await instantiateMvm();
  const allocLen = Math.max(1, mbcBytes.length);
  const ptr = exports.mvm_alloc(allocLen);
  try {
    new Uint8Array(exports.memory.buffer, ptr, mbcBytes.length).set(mbcBytes);
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
  const exports = await instantiateMvm();
  const allocLen = Math.max(1, mbcBytes.length);
  const ptr = exports.mvm_alloc(allocLen);
  try {
    new Uint8Array(exports.memory.buffer, ptr, mbcBytes.length).set(mbcBytes);
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
  const granted = options.grantedCapabilities ?? ['console'];
  const vfs: Record<string, string> = { ...(options.virtualFiles || {}) };

  const exports = await instantiateMvm((symbol, _capability, args) => {
    switch (symbol) {
      case 'console.print':
      case 'print':
      case 'println':
      case 'std::io::print':
      case 'std::io::println': {
        if (options.onConsoleLog) {
          options.onConsoleLog(args.join(' '));
        }
        return { ok: true, payload: 'void:' };
      }
      case 'time.now':
      case 'std::time::now': {
        return { ok: true, payload: `i64:${Date.now()}` };
      }
      case 'fs.read_text':
      case 'std::fs::read_text': {
        const path = args[0] || '';
        if (!(path in vfs)) {
          return { ok: false, payload: `File '${path}' not found in workspace` };
        }
        return { ok: true, payload: `str:${vfs[path]}` };
      }
      case 'fs.write_text':
      case 'std::fs::write_text': {
        const path = args[0] || '';
        const content = args[1] ?? '';
        vfs[path] = content;
        return { ok: true, payload: 'bool:true' };
      }
      case 'net.get':
      case 'std::net::get':
      case 'fetch': {
        const url = args[0] || '';
        if (options.networkHandler) {
          return { ok: true, payload: `str:${options.networkHandler(url)}` };
        }
        return {
          ok: false,
          payload: `Synchronous network access to '${url}' blocked by sandbox policy unless an explicit host network adapter is configured`,
        };
      }
      case 'db.query':
      case 'std::db::query': {
        const q = args[0] || '';
        if (options.dbHandler) {
          return { ok: true, payload: `str:${options.dbHandler(q)}` };
        }
        return { ok: true, payload: `str:[]` };
      }
      default:
        return { ok: false, payload: `Unsupported host symbol '${symbol}'` };
    }
  });

  const cfgLines: string[] = [];
  if (options.maxSteps !== undefined) cfgLines.push(`MAX_STEPS=${options.maxSteps}`);
  if (options.maxCallDepth !== undefined) cfgLines.push(`MAX_DEPTH=${options.maxCallDepth}`);
  if (options.maxHeapObjects !== undefined) cfgLines.push(`MAX_HEAP=${options.maxHeapObjects}`);
  if (options.entryFunction) cfgLines.push(`ENTRY=${options.entryFunction}`);
  for (const cap of granted) {
    cfgLines.push(`GRANT=${cap}`);
  }
  const cfgBytes = new TextEncoder().encode(cfgLines.join('\n'));

  const mbcAlloc = Math.max(1, mbcBytes.length);
  const cfgAlloc = Math.max(1, cfgBytes.length);
  const mbcPtr = exports.mvm_alloc(mbcAlloc);
  const cfgPtr = exports.mvm_alloc(cfgAlloc);

  try {
    new Uint8Array(exports.memory.buffer, mbcPtr, mbcBytes.length).set(mbcBytes);
    new Uint8Array(exports.memory.buffer, cfgPtr, cfgBytes.length).set(cfgBytes);
    exports.mvm_execute(mbcPtr, mbcBytes.length, cfgPtr, cfgBytes.length);

    const parsed = readOutputJson<{
      ok: boolean;
      phase?: 'decode' | 'verify' | 'runtime';
      returnType?: string;
      returnValue?: string;
      stdout?: string[];
      steps?: number;
      heapObjects?: number;
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
      error: parsed.error,
      virtualFiles: vfs,
    };
  } finally {
    exports.mvm_dealloc(mbcPtr, mbcAlloc);
    exports.mvm_dealloc(cfgPtr, cfgAlloc);
  }
}
