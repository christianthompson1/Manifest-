export type CompilerTargetId =
  | 'mvm'
  | 'web-js'
  | 'wasm'
  | 'native'
  | 'solana-sbf'
  | 'evm-solidity'
  | 'move'
  | 'ton-tact';

export type CompilerTargetStatus =
  | 'available'
  | 'available-with-limitations'
  | 'requires-toolchain'
  | 'planned';

export interface CompilerTargetArtifact {
  filename: string;
  mimeType: string;
  isBinary: boolean;
  bytes?: Uint8Array;
  text?: string;
}

export interface CompilerTargetSpec {
  id: CompilerTargetId;
  aliases: string[];
  name: string;
  shortLabel: string;
  status: CompilerTargetStatus;
  canRunInStudio: boolean;
  canBuildInStudio: boolean;
  artifactExtensions: string[];
  requiredToolchains: string[];
  limitations: string[];
  description: string;
}

export const COMPILER_TARGETS: CompilerTargetSpec[] = [
  {
    id: 'mvm',
    aliases: ['mbc', 'vm', 'manifest-vm'],
    name: 'Manifest VM (.mbc)',
    shortLabel: 'Manifest VM (.mbc)',
    status: 'available',
    canRunInStudio: true,
    canBuildInStudio: true,
    artifactExtensions: ['.mbc', '.disasm.txt'],
    requiredToolchains: ['Built-in Rust MVM (WASM & Native CLI)'],
    limitations: [],
    description:
      'Compiles to portable binary Manifest Bytecode (.mbc v1.0), statically verifies stack/jump/capability invariants, and executes on the Rust Manifest Virtual Machine.',
  },
  {
    id: 'web-js',
    aliases: ['js', 'web', 'javascript'],
    name: 'JavaScript / Web',
    shortLabel: 'JavaScript / Web',
    status: 'available',
    canRunInStudio: true,
    canBuildInStudio: true,
    artifactExtensions: ['.js', '.html'],
    requiredToolchains: ['Sandboxed Browser Runtime'],
    limitations: [
      'Direct filesystem capability (fs.read / fs.write) uses virtual workspace storage in the browser sandbox.',
    ],
    description:
      'Compiles general-purpose Manifest modules and declarative UI apps to capability-restricted ES modules and sandboxed HTML previews.',
  },
  {
    id: 'wasm',
    aliases: ['webassembly'],
    name: 'WebAssembly (.wasm)',
    shortLabel: 'WebAssembly (.wasm)',
    status: 'available-with-limitations',
    canRunInStudio: true,
    canBuildInStudio: true,
    artifactExtensions: ['.wasm', '.wat'],
    requiredToolchains: ['Built-in W3C WASM Binary Emitter'],
    limitations: [
      'Direct .wasm codegen supports numeric types (i64, f64, bool), globals, functions, recursion, loops, conditionals, and console numeric output. Heap-allocated strings, maps, and algebraic enums require the Manifest VM (.mbc) target.',
    ],
    description:
      'Compiles Manifest numeric and control-flow functions directly to standalone W3C WebAssembly (.wasm) binaries verified with WebAssembly.validate().',
  },
  {
    id: 'native',
    aliases: ['bin', 'elf', 'executable'],
    name: 'Native Executable',
    shortLabel: 'Native',
    status: 'requires-toolchain',
    canRunInStudio: false,
    canBuildInStudio: true,
    artifactExtensions: ['', '.rs'],
    requiredToolchains: ['Host Rust Compiler (rustc >= 1.75)'],
    limitations: [
      'Compiling native machine binaries requires a host OS Rust toolchain (rustc). Browser-only Studio builds emit verified standalone Rust codegen (.rs); CLI and local host builds invoke rustc directly to produce native ELF/Mach-O/PE executables.',
    ],
    description:
      'Lowers Typed Manifest IR to memory-safe standalone Rust source and invokes host rustc when available to emit a native OS executable.',
  },
  {
    id: 'solana-sbf',
    aliases: ['solana', 'anchor'],
    name: 'Solana (SBF)',
    shortLabel: 'Solana (SBF)',
    status: 'available-with-limitations',
    canRunInStudio: true,
    canBuildInStudio: true,
    artifactExtensions: ['.rs', '.idl.json'],
    requiredToolchains: ['Anchor / cargo-build-sbf (for deployable .so binary)'],
    limitations: [
      'Generates Anchor Rust program source and Anchor IDL JSON, and simulates state/account invariants locally. Compiling a deployable SBF .so binary requires external cargo-build-sbf.',
    ],
    description:
      'Compiles smart-contract modules to Solana Anchor Rust + IDL JSON with deterministic account and invariant simulation.',
  },
  {
    id: 'evm-solidity',
    aliases: ['evm', 'solidity'],
    name: 'Solidity / EVM',
    shortLabel: 'Solidity / EVM',
    status: 'planned',
    canRunInStudio: false,
    canBuildInStudio: false,
    artifactExtensions: ['.sol'],
    requiredToolchains: ['solc / Foundry (Planned)'],
    limitations: ['Target backend is planned for a future release and is not yet implemented.'],
    description: 'Planned smart-contract compilation target for EVM-compatible chains.',
  },
  {
    id: 'move',
    aliases: ['aptos-move', 'sui-move'],
    name: 'Move',
    shortLabel: 'Move',
    status: 'planned',
    canRunInStudio: false,
    canBuildInStudio: false,
    artifactExtensions: ['.move'],
    requiredToolchains: ['Move CLI (Planned)'],
    limitations: ['Target backend is planned for a future release and is not yet implemented.'],
    description: 'Planned resource-oriented smart-contract target for Move VM ecosystems.',
  },
  {
    id: 'ton-tact',
    aliases: ['tact', 'ton'],
    name: 'Tact / TON',
    shortLabel: 'Tact / TON',
    status: 'planned',
    canRunInStudio: false,
    canBuildInStudio: false,
    artifactExtensions: ['.tact'],
    requiredToolchains: ['Tact Compiler (Planned)'],
    limitations: ['Target backend is planned for a future release and is not yet implemented.'],
    description: 'Planned actor-based smart-contract compilation target for TON.',
  },
];

export function resolveCompilerTarget(raw?: string): CompilerTargetSpec {
  const norm = (raw || 'mvm').trim().toLowerCase();
  for (const spec of COMPILER_TARGETS) {
    if (spec.id === norm || spec.aliases.includes(norm)) {
      return spec;
    }
  }
  return COMPILER_TARGETS[0];
}
