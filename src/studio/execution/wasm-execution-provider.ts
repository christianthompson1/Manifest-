/**
 * Manifest Studio - Real WebAssembly Binary Execution Provider (.wasm)
 * Instantiates and executes compiled WebAssembly (.wasm) binaries locally and offline
 * using the host JavaScript engine's native WebAssembly runtime.
 *
 * NOTE: This provider executes compiled .wasm binary modules.
 * It does NOT compile Manifest source code to WebAssembly (Manifest-to-WASM codegen is not yet implemented).
 */

import {
  ExecutionProvider,
  ProjectKind,
  ProviderCapability,
  ExecutionOptions,
  UnifiedExecutionResult,
} from './execution-types.ts';
import { ManifestProject, ProjectFile, StudioDiagnostic } from '../types.ts';

/**
 * Valid, spec-compliant WebAssembly MVP binary module:
 * - Imports `env.print_i32: (i32) -> ()`
 * - Exports `add(a: i32, b: i32) -> i32`
 * - Exports `main() -> i32` which computes `add(20, 22)`, calls `env.print_i32(42)`, and returns `42`
 */
export const STARTER_WASM_BYTES = new Uint8Array([
  // Magic (\0asm) + Version (1)
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // Type section (3 types: 0=(i32)->(), 1=(i32,i32)->(i32), 2=()->(i32))
  0x01, 0x0f, 0x03,
  0x60, 0x01, 0x7f, 0x00,
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x60, 0x00, 0x01, 0x7f,
  // Import section: env.print_i32 (func type 0)
  0x02, 0x11, 0x01,
  0x03, 0x65, 0x6e, 0x76,
  0x09, 0x70, 0x72, 0x69, 0x6e, 0x74, 0x5f, 0x69, 0x33, 0x32,
  0x00, 0x00,
  // Function section: func 1 -> type 1 (add), func 2 -> type 2 (main)
  0x03, 0x03, 0x02, 0x01, 0x02,
  // Export section: "add" -> func 1, "main" -> func 2
  0x07, 0x0e, 0x02,
  0x03, 0x61, 0x64, 0x64, 0x00, 0x01,
  0x04, 0x6d, 0x61, 0x69, 0x6e, 0x00, 0x02,
  // Code section: body 1 (add), body 2 (main)
  0x0a, 0x1a, 0x02,
  // add(a, b) => a + b
  0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
  // main() => let x = add(20, 22); print_i32(x); return x;
  0x10, 0x01, 0x01, 0x7f, 0x41, 0x14, 0x41, 0x16, 0x10, 0x01, 0x22, 0x00, 0x10, 0x00, 0x20, 0x00, 0x0b,
]);

export function encodeWasmDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return `data:application/wasm;base64,${base64}`;
}

export function decodeWasmFileContent(content: string): Uint8Array {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    throw new Error('Empty .wasm file content.');
  }

  // 1. Data URL: data:application/wasm;base64,... or data:application/octet-stream;base64,...
  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx === -1) {
      throw new Error('Malformed data URL in .wasm file.');
    }
    const b64 = trimmed.slice(commaIdx + 1).replace(/\s+/g, '');
    return decodeBase64ToBytes(b64);
  }

  // 2. Hex representation (optional convenience: e.g. "00 61 73 6d 01 00 00 00 ...")
  if (/^(?:0x)?[0-9a-fA-F]{2}(?:[\s,]+(?:0x)?[0-9a-fA-F]{2})+$/.test(trimmed)) {
    const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
    const out = new Uint8Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      out[i] = parseInt(tokens[i].replace(/^0x/i, ''), 16);
    }
    return out;
  }

  // 3. Raw binary string starting with \0asm
  if (trimmed.length >= 4 && content.charCodeAt(0) === 0x00 && content.slice(1, 4) === 'asm') {
    const out = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) {
      out[i] = content.charCodeAt(i) & 0xff;
    }
    return out;
  }

  // 4. Plain base64 string (AGFzbQEAAA...)
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length >= 8) {
    return decodeBase64ToBytes(trimmed.replace(/\s+/g, ''));
  }

  throw new Error(
    'Unrecognized .wasm file encoding. Expected binary data URL (data:application/wasm;base64,...), base64 bytes, or hex bytes.'
  );
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

class WasiExitSignal extends Error {
  public readonly exitCode: number;
  constructor(exitCode: number) {
    super(`WASI process exited with code ${exitCode}`);
    this.exitCode = exitCode;
  }
}

export class WasmExecutionProvider implements ExecutionProvider {
  public readonly id = 'wasm-provider';
  public readonly name = 'WebAssembly Binary Runtime (.wasm)';
  public readonly supportedKinds: ProjectKind[] = ['wasm'];

  private static readonly MAX_WASM_BYTES = 16 * 1024 * 1024; // 16 MiB module bound
  private static readonly MAX_STDOUT_LINES = 1000;

  public detect(project: ManifestProject, activeFile?: ProjectFile): boolean {
    if (activeFile && (activeFile.path.endsWith('.wasm') || activeFile.language === 'wasm')) {
      return true;
    }
    if (project.kind === 'wasm') return true;
    return false;
  }

  public async validate(
    project: ManifestProject,
    activeFile?: ProjectFile
  ): Promise<{ isValid: boolean; diagnostics: StudioDiagnostic[] }> {
    const wasmFile = this.resolveWasmFile(project, activeFile);
    if (!wasmFile) {
      return {
        isValid: false,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: 'No compiled .wasm binary file found in project.',
            severity: 'error',
            source: 'wasm-provider',
          },
        ],
      };
    }

    try {
      const bytes = decodeWasmFileContent(wasmFile.content);
      if (bytes.byteLength > WasmExecutionProvider.MAX_WASM_BYTES) {
        return {
          isValid: false,
          diagnostics: [
            {
              line: 1,
              column: 1,
              message: `WebAssembly module exceeds 16 MiB safety limit (${bytes.byteLength} bytes).`,
              severity: 'error',
              source: 'wasm-provider',
            },
          ],
        };
      }
      if (
        bytes.byteLength < 8 ||
        bytes[0] !== 0x00 ||
        bytes[1] !== 0x61 ||
        bytes[2] !== 0x73 ||
        bytes[3] !== 0x6d
      ) {
        return {
          isValid: false,
          diagnostics: [
            {
              line: 1,
              column: 1,
              message: 'Invalid WebAssembly binary header (missing \\0asm magic bytes). Note: .wat text format is not compiled in-browser.',
              severity: 'error',
              source: 'wasm-provider',
            },
          ],
        };
      }

      if (!WebAssembly.validate(bytes as BufferSource)) {
        return {
          isValid: false,
          diagnostics: [
            {
              line: 1,
              column: 1,
              message: 'WebAssembly.validate() rejected binary module (malformed bytecode or invalid stack types).',
              severity: 'error',
              source: 'wasm-provider',
            },
          ],
        };
      }

      return { isValid: true, diagnostics: [] };
    } catch (err: any) {
      return {
        isValid: false,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: err.message || String(err),
            severity: 'error',
            source: 'wasm-provider',
          },
        ],
      };
    }
  }

  public async execute(project: ManifestProject, options: ExecutionOptions = {}): Promise<UnifiedExecutionResult> {
    const startTime = performance.now();
    const runId = options.runId || `wasm-run-${Date.now()}`;
    const activeFile = options.activeFilePath
      ? project.files.find((f) => f.path === options.activeFilePath)
      : undefined;
    const wasmFile = this.resolveWasmFile(project, activeFile);

    if (!wasmFile) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'wasm',
        previewKind: 'diagnostic-error',
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: 'No .wasm binary module found to execute.',
            severity: 'error',
            source: 'wasm-provider',
          },
        ],
        logs: ['[WASM Provider] Error: No .wasm module found.'],
        durationMs: Math.round(performance.now() - startTime),
        error: 'No .wasm binary module found.',
      };
    }

    const validation = await this.validate(project, wasmFile);
    if (!validation.isValid) {
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'wasm',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: wasmFile.path,
        diagnostics: validation.diagnostics,
        logs: validation.diagnostics.map((d) => `[WASM Error] ${d.message}`),
        durationMs: Math.round(performance.now() - startTime),
        error: validation.diagnostics[0]?.message || 'Invalid WebAssembly binary.',
      };
    }

    try {
      const bytes = decodeWasmFileContent(wasmFile.content);
      const compiledModule = await WebAssembly.compile(bytes as BufferSource);

      const stdoutLogs: string[] = [];
      const pushLog = (line: string) => {
        if (stdoutLogs.length < WasmExecutionProvider.MAX_STDOUT_LINES) {
          stdoutLogs.push(line);
        }
      };

      // Bounded host linear memory (64 KiB initial, 16 MiB maximum = 256 pages)
      const fallbackMemory = new WebAssembly.Memory({ initial: 1, maximum: 256 });
      let activeMemory: WebAssembly.Memory = fallbackMemory;

      const textDecoder = new TextDecoder('utf-8');

      // Capability-scoped host imports
      const hostImports: WebAssembly.Imports = {
        env: {
          memory: fallbackMemory,
          print_i32: (val: number) => pushLog(`${val}`),
          print_f64: (val: number) => pushLog(`${val}`),
          log: (val: number) => pushLog(`${val}`),
          abort: (_msg: number, _file: number, line: number, col: number) => {
            throw new Error(`WASM abort() trapped at ${line}:${col}`);
          },
        },
        wasi_snapshot_preview1: {
          fd_write: (fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number => {
            if (fd !== 1 && fd !== 2) return 8; // EBADF
            const view = new DataView(activeMemory.buffer);
            const memBytes = new Uint8Array(activeMemory.buffer);
            let totalWritten = 0;
            let chunkText = '';

            for (let i = 0; i < iovsLen; i++) {
              const ptr = view.getUint32(iovsPtr + i * 8, true);
              const len = view.getUint32(iovsPtr + i * 8 + 4, true);
              if (ptr + len > memBytes.byteLength) return 21; // EFAULT
              chunkText += textDecoder.decode(memBytes.subarray(ptr, ptr + len), { stream: true });
              totalWritten += len;
            }
            const lines = chunkText.replace(/\n$/, '').split('\n');
            for (const l of lines) {
              if (l.length > 0 || lines.length > 1) {
                pushLog(fd === 2 ? `[stderr] ${l}` : l);
              }
            }
            view.setUint32(nwrittenPtr, totalWritten, true);
            return 0;
          },
          proc_exit: (code: number) => {
            throw new WasiExitSignal(code);
          },
          environ_sizes_get: (countPtr: number, bufSizePtr: number): number => {
            const view = new DataView(activeMemory.buffer);
            view.setUint32(countPtr, 0, true);
            view.setUint32(bufSizePtr, 0, true);
            return 0;
          },
          environ_get: (): number => 0,
          args_sizes_get: (argcPtr: number, argvBufSizePtr: number): number => {
            const view = new DataView(activeMemory.buffer);
            view.setUint32(argcPtr, 0, true);
            view.setUint32(argvBufSizePtr, 0, true);
            return 0;
          },
          args_get: (): number => 0,
          clock_time_get: (_id: number, _precision: bigint, timePtr: number): number => {
            const view = new DataView(activeMemory.buffer);
            view.setBigUint64(timePtr, BigInt(Math.round(performance.now() * 1e6)), true);
            return 0;
          },
          fd_close: (): number => 0,
          fd_fdstat_get: (): number => 0,
          fd_seek: (): number => 0,
        },
      };

      // Inspect required imports prior to instantiation for explicit capability error reporting
      const requiredImports = WebAssembly.Module.imports(compiledModule);
      const unsupportedImports = requiredImports.filter((imp) => {
        const modNamespace = hostImports[imp.module] as Record<string, unknown> | undefined;
        return !modNamespace || !(imp.name in modNamespace);
      });

      if (unsupportedImports.length > 0) {
        const missingList = unsupportedImports.map((u) => `${u.module}.${u.name} (${u.kind})`).join(', ');
        const msg = `Unsupported WebAssembly host import(s): ${missingList}. Supported namespaces: env.{memory,print_i32,print_f64,log,abort}, wasi_snapshot_preview1.{fd_write,proc_exit,...}.`;
        return {
          runId,
          timestamp: Date.now(),
          success: false,
          providerId: this.id,
          projectKind: 'wasm',
          previewKind: 'diagnostic-error',
          resolvedEntryPath: wasmFile.path,
          diagnostics: [
            {
              line: 1,
              column: 1,
              message: msg,
              severity: 'error',
              source: 'wasm-provider',
            },
          ],
          logs: [`[WASM Provider] ${msg}`],
          durationMs: Math.round(performance.now() - startTime),
          error: msg,
        };
      }

      const instance = await WebAssembly.instantiate(compiledModule, hostImports);
      if (instance.exports.memory instanceof WebAssembly.Memory) {
        activeMemory = instance.exports.memory;
      }

      const exportEntries = WebAssembly.Module.exports(compiledModule);
      const exportedFunctions = exportEntries.filter((e) => e.kind === 'function').map((e) => e.name);

      // Select entry point deterministically: _start -> main -> run -> first 0-arg exported function
      const preferredEntryNames = ['_start', 'main', 'run'];
      let invokedSymbol: string | null = null;
      let returnValue: unknown = undefined;

      for (const candidate of preferredEntryNames) {
        const fn = instance.exports[candidate];
        if (typeof fn === 'function') {
          invokedSymbol = `${candidate}()`;
          try {
            returnValue = (fn as Function)();
          } catch (sig: any) {
            if (sig instanceof WasiExitSignal) {
              returnValue = sig.exitCode;
              if (sig.exitCode !== 0) {
                throw new Error(`WASI module exited with non-zero status ${sig.exitCode}`);
              }
            } else {
              throw sig;
            }
          }
          break;
        }
      }

      // If no _start/main/run exists, invoke first zero-arg function if available
      if (!invokedSymbol) {
        for (const fnName of exportedFunctions) {
          const fn = instance.exports[fnName] as Function;
          if (typeof fn === 'function' && fn.length === 0) {
            invokedSymbol = `${fnName}()`;
            returnValue = fn();
            break;
          }
        }
      }

      const durationMs = Math.round(performance.now() - startTime);
      const summaryLogs: string[] = [
        `[WASM Runtime] Instantiated "${wasmFile.path}" (${bytes.byteLength} bytes) in ${durationMs}ms`,
        `[WASM Exports] ${exportEntries.map((e) => `${e.name} (${e.kind})`).join(', ') || 'none'}`,
      ];
      if (invokedSymbol) {
        summaryLogs.push(
          `[WASM Entry] ${invokedSymbol} => ${returnValue !== undefined ? String(returnValue) : 'void'}`
        );
      } else {
        summaryLogs.push(
          `[WASM Notice] Module instantiated cleanly; no zero-argument entry (_start/main/run) exported.`
        );
      }
      for (const out of stdoutLogs) {
        summaryLogs.push(`[WASM Output] ${out}`);
      }

      const previewHtml = this.generateTerminalPreviewHtml(
        wasmFile.path,
        bytes.byteLength,
        exportEntries,
        invokedSymbol,
        returnValue,
        stdoutLogs,
        durationMs
      );

      return {
        runId,
        timestamp: Date.now(),
        success: true,
        providerId: this.id,
        projectKind: 'wasm',
        previewKind: 'terminal-output',
        resolvedEntryPath: wasmFile.path,
        previewHtml,
        diagnostics: [],
        logs: summaryLogs,
        state: {
          moduleBytes: bytes.byteLength,
          exports: exportedFunctions,
          entry: invokedSymbol,
          returnValue: returnValue !== undefined ? Number(returnValue) : null,
          stdout: stdoutLogs,
        },
        durationMs,
      };
    } catch (err: any) {
      const msg = err.message || String(err);
      return {
        runId,
        timestamp: Date.now(),
        success: false,
        providerId: this.id,
        projectKind: 'wasm',
        previewKind: 'diagnostic-error',
        resolvedEntryPath: wasmFile.path,
        diagnostics: [
          {
            line: 1,
            column: 1,
            message: `WebAssembly runtime trap: ${msg}`,
            severity: 'error',
            source: 'wasm-provider',
          },
        ],
        logs: [`[WASM Trap] ${msg}`],
        durationMs: Math.round(performance.now() - startTime),
        error: msg,
      };
    }
  }

  public getCapabilities(): ProviderCapability {
    return {
      editing: false,
      syntaxHighlighting: false,
      localExecution: true,
      localBuild: false,
      offlineReady: true,
      previewSupported: true,
      requiredRuntime: 'Browser/Host Native WebAssembly VM (MVP + Minimal WASI Preview1)',
      runtimeInstallStatus: 'browser-native',
    };
  }

  public isOfflineReady(): boolean {
    return typeof WebAssembly !== 'undefined';
  }

  private resolveWasmFile(project: ManifestProject, activeFile?: ProjectFile): ProjectFile | undefined {
    if (activeFile && (activeFile.path.endsWith('.wasm') || activeFile.language === 'wasm')) {
      return activeFile;
    }
    if (project.entryPath) {
      const configured = project.files.find((f) => f.path === project.entryPath);
      if (configured && configured.path.endsWith('.wasm')) return configured;
    }
    return project.files.find((f) => f.path.endsWith('.wasm') || f.language === 'wasm');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private generateTerminalPreviewHtml(
    filePath: string,
    byteLength: number,
    exportsList: WebAssembly.ModuleExportDescriptor[],
    invokedSymbol: string | null,
    returnValue: unknown,
    stdoutLogs: string[],
    durationMs: number
  ): string {
    const exportsBadges = exportsList
      .map(
        (e) =>
          `<span style="display:inline-block;padding:2px 8px;margin:2px 4px 2px 0;border-radius:4px;background:#252526;border:1px solid #2d2d2d;color:#9cdcfe;font-size:11px;">${this.escapeHtml(
            e.name
          )} <span style="color:#858585;">(${this.escapeHtml(e.kind)})</span></span>`
      )
      .join('');

    const stdoutRows =
      stdoutLogs.length > 0
        ? stdoutLogs.map((l) => `<div style="color:#89d185;">&gt; ${this.escapeHtml(l)}</div>`).join('')
        : `<div style="color:#858585;font-style:italic;">(No stdout emitted via env.print_* or WASI fd_write)</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WebAssembly Binary Execution</title>
  <style>
    body {
      background: #1f1f1f;
      color: #cccccc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 20px;
      margin: 0;
      font-size: 12px;
      line-height: 1.6;
    }
    .panel {
      background: #181818;
      border: 1px solid #2d2d2d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .label {
      color: #858585;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="label">WebAssembly Binary Execution (.wasm)</div>
    <div style="color:#ffffff;font-size:14px;font-weight:600;margin-bottom:4px;">${this.escapeHtml(filePath)}</div>
    <div style="color:#858585;font-size:11px;">Binary Size: <span style="color:#b5cea8;">${byteLength} bytes</span> &bull; Execution Time: <span style="color:#b5cea8;">${durationMs}ms</span></div>
  </div>

  <div class="panel">
    <div class="label">Exported Symbols</div>
    <div>${exportsBadges || '<span style="color:#858585;">None</span>'}</div>
  </div>

  <div class="panel">
    <div class="label">Entry Invocation &amp; Return Value</div>
    ${
      invokedSymbol
        ? `<div><span style="color:#dcdcaa;">${this.escapeHtml(invokedSymbol)}</span> &rarr; <span style="color:#4ec9b0;font-weight:700;">${
            returnValue !== undefined ? this.escapeHtml(String(returnValue)) : 'void'
          }</span></div>`
        : `<div style="color:#cca700;">No zero-argument entry point (_start, main, run) exported.</div>`
    }
  </div>

  <div class="panel">
    <div class="label">Captured Standard Output</div>
    ${stdoutRows}
  </div>
</body>
</html>`;
  }
}
