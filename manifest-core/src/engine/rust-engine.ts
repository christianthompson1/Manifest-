import { SyntaxProfile } from '../core/profile.ts';
import { OptimizationPassStats } from '../ir/ir-optimizer.ts';
import { MIRExpr, MIRMatchArm, MIRModule, MIRStmt } from '../ir/typed-ir.ts';
import { CapabilityAuditReport } from '../semantics/capability-analyzer.ts';
import { SemanticDiagnostic } from '../semantics/types.ts';
import {
  getCompilerWasmExports,
  getRustMvmEngineInfo,
  MAX_WASM_COMPILER_IO_BYTES,
  MvmWasmEngineInfo,
  MvmWasmExports,
  readOutputJson,
  writeValidatedWasmBytes,
} from '../vm/mvm-runner.ts';

export interface RustEngineCompileOptions {
  profile?: SyntaxProfile | 'auto';
  entryFile?: string;
  files?: Record<string, string>;
  optimize?: boolean;
}

export interface RustAstSummaryParam {
  name: string;
  typeStr: string;
}

export interface RustAstSummaryFunction {
  name: string;
  exported: boolean;
  params: RustAstSummaryParam[];
  returnTypeStr: string;
  effects: string[];
  line: number;
}

export interface RustAstSummaryField {
  name: string;
  typeStr: string;
}

export interface RustAstSummaryStruct {
  name: string;
  exported: boolean;
  fields: RustAstSummaryField[];
  line: number;
}

export interface RustAstSummaryEnum {
  name: string;
  exported: boolean;
  variants: string[];
  line: number;
}

export interface RustAstSummaryConstant {
  name: string;
  typeStr: string;
  line: number;
}

export interface RustAstSummaryGlobal {
  name: string;
  mutable: boolean;
  typeStr: string;
  line: number;
}

export interface RustAstSummary {
  moduleName: string;
  profile: SyntaxProfile;
  functions: RustAstSummaryFunction[];
  structs: RustAstSummaryStruct[];
  enums: RustAstSummaryEnum[];
  constants: RustAstSummaryConstant[];
  globals: RustAstSummaryGlobal[];
}

export interface RustCheckResult {
  ok: boolean;
  engine: string;
  engineVersion: string;
  engineAbiVersion: number;
  resolvedProfile: SyntaxProfile;
  moduleName: string;
  isDomainExtension: boolean;
  domainKind?: 'solana-contract';
  diagnostics: SemanticDiagnostic[];
  capabilityAudit?: CapabilityAuditReport;
  mir?: MIRModule;
  irText?: string;
  optimizationStats?: OptimizationPassStats;
  astSummary?: RustAstSummary;
}

export interface RustCompileResult extends RustCheckResult {
  mbcBytes?: Uint8Array;
  mbcByteLength: number;
  functionCount?: number;
  constantCount?: number;
  importCount?: number;
  disassembly?: string;
}

interface RawRustCheckJson {
  ok: boolean;
  engine?: string;
  engineVersion?: string;
  engineAbiVersion?: number;
  resolvedProfile?: SyntaxProfile;
  moduleName?: string;
  isDomainExtension?: boolean;
  domainKind?: 'solana-contract' | null;
  diagnostics?: SemanticDiagnostic[];
  capabilityAudit?: CapabilityAuditReport | null;
  mir?: unknown;
  irText?: string | null;
  optimizationStats?: OptimizationPassStats | null;
  astSummary?: RustAstSummary | null;
}

interface RawRustCompileJson extends RawRustCheckJson {
  mbcBase64?: string | null;
  mbcByteLength?: number;
  functionCount?: number;
  constantCount?: number;
  importCount?: number;
  disassembly?: string | null;
}

const textEncoder = new TextEncoder();

function decodeBase64ToUint8Array(b64: string): Uint8Array {
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

function reviveMirExpr(raw: any): MIRExpr {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }
  switch (raw.kind) {
    case 'ConstInt':
      return {
        ...raw,
        value: typeof raw.value === 'bigint' ? raw.value : BigInt(raw.value ?? 0),
      };
    case 'Binary':
      return {
        ...raw,
        left: reviveMirExpr(raw.left),
        right: reviveMirExpr(raw.right),
      };
    case 'Unary':
    case 'Cast':
    case 'TryPropagate':
      return {
        ...raw,
        operand: reviveMirExpr(raw.operand),
      };
    case 'CallFunction':
    case 'CallIntrinsic':
    case 'EnumNew':
      return {
        ...raw,
        args: Array.isArray(raw.args) ? raw.args.map(reviveMirExpr) : [],
      };
    case 'ArrayNew':
      return {
        ...raw,
        elements: Array.isArray(raw.elements) ? raw.elements.map(reviveMirExpr) : [],
      };
    case 'ArrayGet':
      return {
        ...raw,
        array: reviveMirExpr(raw.array),
        index: reviveMirExpr(raw.index),
      };
    case 'ArrayLen':
      return {
        ...raw,
        target: reviveMirExpr(raw.target),
      };
    case 'ArrayPush':
      return {
        ...raw,
        array: reviveMirExpr(raw.array),
        value: reviveMirExpr(raw.value),
      };
    case 'MapNew':
      return {
        ...raw,
        entries: Array.isArray(raw.entries)
          ? raw.entries.map((kv: any) => ({
              key: reviveMirExpr(kv.key),
              value: reviveMirExpr(kv.value),
            }))
          : [],
      };
    case 'MapGet':
    case 'MapHas':
      return {
        ...raw,
        map: reviveMirExpr(raw.map),
        key: reviveMirExpr(raw.key),
      };
    case 'MapSet':
      return {
        ...raw,
        map: reviveMirExpr(raw.map),
        key: reviveMirExpr(raw.key),
        value: reviveMirExpr(raw.value),
      };
    case 'StructNew':
      return {
        ...raw,
        fields: Array.isArray(raw.fields) ? raw.fields.map(reviveMirExpr) : [],
      };
    case 'FieldGet':
      return {
        ...raw,
        object: reviveMirExpr(raw.object),
      };
    default:
      return raw;
  }
}

function reviveMirMatchArm(arm: any): MIRMatchArm {
  let pattern = arm.pattern;
  if (pattern && pattern.kind === 'Literal' && pattern.litKind === 'i64') {
    pattern = {
      ...pattern,
      value: typeof pattern.value === 'bigint' ? pattern.value : BigInt(pattern.value ?? 0),
    };
  }
  return {
    ...arm,
    pattern,
    body: Array.isArray(arm.body) ? arm.body.map(reviveMirStmt) : [],
  };
}

function reviveMirStmt(stmt: any): MIRStmt {
  if (!stmt || typeof stmt !== 'object') {
    return stmt;
  }
  switch (stmt.kind) {
    case 'StoreLocal':
    case 'StoreGlobal':
      return {
        ...stmt,
        value: reviveMirExpr(stmt.value),
      };
    case 'ArraySet':
      return {
        ...stmt,
        array: reviveMirExpr(stmt.array),
        index: reviveMirExpr(stmt.index),
        value: reviveMirExpr(stmt.value),
      };
    case 'MapSetStmt':
      return {
        ...stmt,
        map: reviveMirExpr(stmt.map),
        key: reviveMirExpr(stmt.key),
        value: reviveMirExpr(stmt.value),
      };
    case 'FieldSet':
      return {
        ...stmt,
        object: reviveMirExpr(stmt.object),
        value: reviveMirExpr(stmt.value),
      };
    case 'ExprStmt':
      return {
        ...stmt,
        expr: reviveMirExpr(stmt.expr),
      };
    case 'If':
      return {
        ...stmt,
        condition: reviveMirExpr(stmt.condition),
        thenBranch: Array.isArray(stmt.thenBranch) ? stmt.thenBranch.map(reviveMirStmt) : [],
        elseBranch: Array.isArray(stmt.elseBranch) ? stmt.elseBranch.map(reviveMirStmt) : [],
      };
    case 'While':
      return {
        ...stmt,
        condition: reviveMirExpr(stmt.condition),
        body: Array.isArray(stmt.body) ? stmt.body.map(reviveMirStmt) : [],
      };
    case 'Return':
      return stmt.value !== undefined
        ? { ...stmt, value: reviveMirExpr(stmt.value) }
        : stmt;
    case 'Match':
      return {
        ...stmt,
        subject: reviveMirExpr(stmt.subject),
        arms: Array.isArray(stmt.arms) ? stmt.arms.map(reviveMirMatchArm) : [],
      };
    default:
      return stmt;
  }
}

export function reviveMirFromRust(rawMir: unknown): MIRModule | undefined {
  if (!rawMir || typeof rawMir !== 'object') {
    return undefined;
  }
  const mod = rawMir as any;
  return {
    ...mod,
    globals: Array.isArray(mod.globals)
      ? mod.globals.map((g: any) => ({
          ...g,
          init: reviveMirExpr(g.init),
        }))
      : [],
    functions: Array.isArray(mod.functions)
      ? mod.functions.map((fn: any) => ({
          ...fn,
          body: Array.isArray(fn.body) ? fn.body.map(reviveMirStmt) : [],
        }))
      : [],
  } as MIRModule;
}

function buildCompilerRequestBytes(source: string, options: RustEngineCompileOptions): Uint8Array {
  const payload: Record<string, unknown> = {
    source,
    entryFile: options.entryFile || 'src/main.manifest',
    optimize: options.optimize !== false,
  };
  if (options.profile === 'beginner' || options.profile === 'professional') {
    payload.profile = options.profile;
  }
  if (options.files && Object.keys(options.files).length > 0) {
    payload.files = options.files;
  }
  return textEncoder.encode(JSON.stringify(payload));
}

async function invokeRustCompilerExport<T>(
  exportName: 'mvm_check_source' | 'mvm_compile_source' | 'mvm_inspect_ir',
  source: string,
  options: RustEngineCompileOptions
): Promise<T> {
  const exports: MvmWasmExports = await getCompilerWasmExports();
  const fn = exports[exportName];
  if (typeof fn !== 'function') {
    throw new Error(
      `Authoritative Rust WASM bundle does not export '${exportName}'. Run 'npm run mvm:build:wasm'.`
    );
  }
  const reqBytes = buildCompilerRequestBytes(source, options);
  const { ptr, allocLen } = writeValidatedWasmBytes(
    exports,
    reqBytes,
    MAX_WASM_COMPILER_IO_BYTES
  );
  try {
    fn(ptr, reqBytes.length);
    return readOutputJson<T>(exports, MAX_WASM_COMPILER_IO_BYTES);
  } finally {
    exports.mvm_dealloc(ptr, allocLen);
  }
}

function mapRawCheckResult(raw: RawRustCheckJson): RustCheckResult {
  return {
    ok: Boolean(raw.ok),
    engine: raw.engine || 'rust-manifest-compiler',
    engineVersion: raw.engineVersion || '1.0.0',
    engineAbiVersion: raw.engineAbiVersion ?? 1,
    resolvedProfile: raw.resolvedProfile || 'professional',
    moduleName: raw.moduleName || 'main',
    isDomainExtension: Boolean(raw.isDomainExtension),
    domainKind: raw.domainKind || undefined,
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
    capabilityAudit: raw.capabilityAudit || undefined,
    mir: reviveMirFromRust(raw.mir),
    irText: raw.irText ?? undefined,
    optimizationStats: raw.optimizationStats || undefined,
    astSummary: raw.astSummary || undefined,
  };
}

export async function inspectRustCompilerEngine(): Promise<MvmWasmEngineInfo> {
  return getRustMvmEngineInfo();
}

export async function checkManifestInRust(
  source: string,
  options: RustEngineCompileOptions = {}
): Promise<RustCheckResult> {
  const raw = await invokeRustCompilerExport<RawRustCheckJson>('mvm_check_source', source, options);
  return mapRawCheckResult(raw);
}

export async function inspectIrInRust(
  source: string,
  options: RustEngineCompileOptions = {}
): Promise<RustCheckResult> {
  const raw = await invokeRustCompilerExport<RawRustCheckJson>('mvm_inspect_ir', source, options);
  return mapRawCheckResult(raw);
}

export async function compileManifestInRust(
  source: string,
  options: RustEngineCompileOptions = {}
): Promise<RustCompileResult> {
  const raw = await invokeRustCompilerExport<RawRustCompileJson>(
    'mvm_compile_source',
    source,
    options
  );
  const base = mapRawCheckResult(raw);
  const mbcBytes =
    typeof raw.mbcBase64 === 'string' && raw.mbcBase64.length > 0
      ? decodeBase64ToUint8Array(raw.mbcBase64)
      : undefined;
  return {
    ...base,
    mbcBytes,
    mbcByteLength: mbcBytes ? mbcBytes.byteLength : raw.mbcByteLength ?? 0,
    functionCount: raw.functionCount,
    constantCount: raw.constantCount,
    importCount: raw.importCount,
    disassembly: raw.disassembly ?? undefined,
  };
}
