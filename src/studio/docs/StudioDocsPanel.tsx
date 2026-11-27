/**
 * Manifest Studio - Comprehensive In-IDE Documentation Panel
 * (src/studio/docs/StudioDocsPanel.tsx)
 *
 * Provides developers with an in-depth, indexed technical guide covering:
 * - Language syntax & dual profile comparison (Beginner vs Professional)
 * - Primitive and algebraic types, functions, modules, error handling
 * - Standard library modules (std::*), capabilities & transitive effects
 * - Portable bytecode (.mbc), Rust MVM, and execution controls
 * - Declarative Web, asynchronous Backend HTTP server, and Solana smart contracts
 * - Asset management (`assets/...`), targets, testing, and troubleshooting
 */

import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Code2,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  Layers,
  Terminal,
  Cpu,
  Globe,
  Server,
  Coins,
  ShieldCheck,
  FileCode,
  ArrowRight,
} from 'lucide-react';

interface DocSection {
  id: string;
  number: number;
  title: string;
  category: string;
  summary: string;
  content: string;
  exampleCode?: string;
  exampleTarget?: string;
}

const DOC_SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    number: 1,
    title: 'Getting Started with Manifest',
    category: 'Fundamentals',
    summary: 'Overview of the Manifest language architecture, workspace files, and build commands.',
    content: `Manifest is a human-readable general-purpose programming language designed to unify software development across web applications, backend services, systems software, and blockchain programs.

A standard project contains:
- manifest.toml: Package metadata, dependencies, and target configuration.
- src/main.manifest: Application entry point.
- assets/: Project assets (images, audio, video, fonts, data).
- build/: Target compilation outputs (.mbc, .js, .wasm, .rs, .idl.json).`,
    exampleCode: `module hello_world;

requires [console];

fn main() -> i64 effects(console) {
    console.print("Hello from Manifest v1.0!");
    return 0;
}`,
    exampleTarget: 'mvm',
  },
  {
    id: 'syntax-profiles',
    number: 2,
    title: 'Dual Syntax Profiles: Beginner & Professional',
    category: 'Syntax',
    summary: 'How Beginner and Professional profiles compile into the same canonical AST and MIR.',
    content: `Manifest maintains one language architecture with two surface profiles:
1. Beginner Profile: Human-readable keywords (MODULE, FUNCTION, LET, SET, IF, LOOP, END).
2. Professional Profile: Concise C/Rust-style syntax (module, fn, let mut, if, for, match).

Both profiles compile into byte-for-byte identical Typed Intermediate Representation (MIR) and execute with identical semantics. Studio includes an automatic formatter to convert between profiles.`,
    exampleCode: `// Professional Profile
module math_demo;
fn double_val(x: i64) -> i64 {
    return x * 2;
}

// Beginner Profile Equivalent
MODULE math_demo
FUNCTION double_val(x: i64) -> i64
    RETURN x * 2
END`,
    exampleTarget: 'mvm',
  },
  {
    id: 'types',
    number: 3,
    title: 'Type System & Data Structures',
    category: 'Language Core',
    summary: 'Primitives (i64, f64, bool, str, bytes), structs, and sum-type enums.',
    content: `Manifest features a sound static type system:
- Primitives: i64 (checked 64-bit integer), f64 (floating point), bool, str (UTF-8), bytes (byte buffers).
- Compound: Array<T>, Map<K, V>, Structs with named fields.
- Sum-Types (Enums): Algebraic data types matching pattern branches.`,
    exampleCode: `enum Status {
    Pending,
    Active(u64),
    Failed(str),
}

struct User {
    id: i64,
    name: str,
    active: bool,
}`,
    exampleTarget: 'mvm',
  },
  {
    id: 'capabilities',
    number: 4,
    title: 'Capabilities & Transitive Effects',
    category: 'Security',
    summary: 'Static and runtime security model with requires, denies, and effects clauses.',
    content: `Security is foundational in Manifest. A program or module cannot access privileged resources (network, filesystem, console, or crypto) unless explicitly declared:
- requires [net, fs.read]: Declares permitted host capabilities.
- denies [net]: Explicitly forbids network access.
- fn calculate() -> i64 effects(pure): Proves that a function has zero side effects, checked up to 3 transitive call hops.`,
    exampleCode: `module secure_vault;

requires [console];
denies [net, fs];

fn hash_data(input: str) -> i64 effects(pure) {
    return std::crypto::simple_hash(input);
}`,
    exampleTarget: 'mvm',
  },
  {
    id: 'mvm-bytecode',
    number: 5,
    title: 'Manifest Virtual Machine (MVM) & Bytecode',
    category: 'Runtime',
    summary: 'The portable .mbc v1.0 binary format, static verification, and Rust MVM execution.',
    content: `The Manifest Virtual Machine is a stack-based runtime implemented in native Rust (mvm-core).
Bytecode containers (.mbc) begin with the magic header MBC\\0 followed by version tables, constant pools, and function bytecode.

Security verifiers statically check:
- Valid instruction boundaries and opcodes
- Stack underflow prevention before execution
- Valid jump targets inside function bounds
- Bounded execution fuel to halt infinite loops`,
    exampleCode: `// Run via CLI:
// manifest build --target mvm
// manifest run build/main.mbc`,
    exampleTarget: 'mvm',
  },
  {
    id: 'web-framework',
    number: 6,
    title: 'Declarative Web Framework & VDOM',
    category: 'Web',
    summary: 'Keyed Virtual DOM reconciliation, fine-grained reactivity, SPA router, and forms.',
    content: `The Manifest web application framework (manifest-core/src/web/manifest-web.ts) provides:
- Keyed list reconciliation (diffAndPatch) preserving intact DOM elements.
- Fine-grained signals (createState, computed) with CircularDependencyError protection.
- Component lifecycle hooks (onMount, onDestroy) and automated listener cleanup.
- SPA router with dynamic parameters (/users/:id) and route guards (canActivate).
- Accessible form validation engine (required, minLength, pattern, numeric).`,
    exampleCode: `// manifest-web.ts companion app (examples/web/commerce_dashboard_app.ts)
module commerce_dashboard;
requires console;

fn main() -> i64 effects(console) {
    console.print("Commerce overview ready");
    return 0;
}`,
    exampleTarget: 'web-js',
  },
  {
    id: 'backend-http',
    number: 7,
    title: 'Backend Programming & HTTP Server',
    category: 'Backend',
    summary: 'ManifestHttpServer binding real OS sockets, JSON streaming, and middleware.',
    content: `The backend framework (manifest-core/src/backend/manifest-server.ts) executes real HTTP services:
- Binds real operating-system TCP sockets via Node http.
- Parameter extraction (/api/users/:id) and query string parsing.
- Streaming JSON request body parsing with 413 payload limit rejection.
- Middleware chaining, CORS headers, 504 timeouts, and graceful shutdown.`,
    exampleCode: `// Manifest Backend Server Definition
requires [net];
import { ManifestHttpServer } from "manifest-server";

// Endpoints declare routes and handle requests`,
    exampleTarget: 'mvm',
  },
  {
    id: 'solana-smart-contracts',
    number: 8,
    title: 'Solana Smart Contracts & SBF Pipeline',
    category: 'Blockchain',
    summary: 'Writing Solana programs in Manifest, Anchor Rust generation, and LiteSVM testing.',
    content: `Manifest treats Solana development as a primary target:
1. Define program accounts, state fields, and instruction constraints.
2. The compiler calculates exact dynamic account space (Anchor 8-byte discriminator + fields).
3. Anchor 0.30+ Rust source and IDL JSON are generated with checked arithmetic (checked_add, checked_sub) and PDA seeds.
4. Real transactions and negative security constraints (unauthorized signers, overdrafts) are verified in-process using native LiteSVM.
5. Deployable SBF .so ELF binaries are compiled in CI using .github/workflows/solana-sbf-build.yml.`,
    exampleCode: `PROGRAM CounterProgram
ACCOUNT CounterState
    count: u64
    authority: pubkey
END

INSTRUCTION increment
    REQUIRES [signer = authority]
    MUTATE state.count = state.count + 1
END`,
    exampleTarget: 'solana-sbf',
  },
  {
    id: 'asset-management',
    number: 9,
    title: 'Project Asset Management & Path Resolution',
    category: 'Tooling',
    summary: 'Organizing images, fonts, audio, and binaries via project-relative assets/... paths.',
    content: `Project assets are stored under assets/ or public/assets/:
- Vector artwork (SVG), raster images (PNG, WebP), audio (MP3, WAV), and fonts (WOFF2, TTF).
- Binary preservation: Assets are stored losslessly in workspace storage.
- Resolution: Manifest source references assets via project-relative paths (e.g. assets/brand/manifest-symbol.svg).
- Directory traversal (../) is blocked at compile time for security.`,
    exampleCode: `module brand_assets;
requires console;

fn main() -> i64 effects(console) {
    let logo_path: str = "assets/brand/manifest-logo-dark.svg";
    console.print("Loaded logo asset: " + logo_path);
    return 0;
}`,
    exampleTarget: 'web-js',
  },
  {
    id: 'standard-library',
    number: 10,
    title: 'Standard Library Modules (std::*)',
    category: 'Standard Library',
    summary: 'Official modules: std::core, std::math, std::string, std::collections, std::net, std::crypto.',
    content: `Standard modules resolve virtually through the module resolver:
- std::core: Memory utilities, assertions, identity.
- std::math: abs, sqrt, min, max, sin, cos, checked pow.
- std::string: upper, lower, trim, split, contains, replace.
- std::collections: List, Map, Set data structures.
- std::crypto: sha256, sha512, hmac (requires [crypto]).
- std::net: HTTP client fetch (requires [net]).`,
    exampleCode: `import { abs, sqrt, max } from "std::math";
import { upper, trim } from "std::string";

fn process(val: i64) -> i64 {
    return max(abs(val), 10);
}`,
    exampleTarget: 'mvm',
  },
];

interface StudioDocsPanelProps {
  onLoadExample?: (code: string, target?: string) => void;
  onShowToast?: (msg: string) => void;
}

export const StudioDocsPanel: React.FC<StudioDocsPanelProps> = ({
  onLoadExample,
  onShowToast,
}) => {
  const [selectedSectionId, setSelectedSectionId] = useState<string>('getting-started');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const selectedSection = DOC_SECTIONS.find((s) => s.id === selectedSectionId) || DOC_SECTIONS[0];

  const filteredSections = DOC_SECTIONS.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q);
  });

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    if (onShowToast) onShowToast('Copied code example');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="flex flex-col md:flex-row h-full bg-[#181818] text-[#cccccc] select-none text-xs">
      {/* Table of Contents / Sidebar */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[#2d2d2d] bg-[#1a1a1a] flex flex-col shrink-0">
        <div className="p-3 border-b border-[#2d2d2d] bg-[#1f1f1f]">
          <div className="flex items-center gap-1.5 font-semibold text-white text-xs mb-2">
            <BookOpen className="w-4 h-4 text-[#58a6ff]" />
            <span>Manifest Documentation</span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#6e7681]" />
            <input
              type="text"
              placeholder="Search guide..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#141414] border border-[#2d2d2d] rounded pl-7 pr-2 py-1 text-xs text-white focus:outline-none focus:border-[#58a6ff]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredSections.map((sec) => (
            <button
              key={sec.id}
              onClick={() => setSelectedSectionId(sec.id)}
              className={`w-full text-left px-2.5 py-1.5 rounded cursor-pointer transition flex items-center justify-between text-xs ${
                selectedSection.id === sec.id
                  ? 'bg-[#094771] text-white font-medium'
                  : 'text-[#8b949e] hover:text-white hover:bg-[#222222]'
              }`}
            >
              <div className="truncate">
                <span className="text-[#6e7681] mr-1.5">{sec.number}.</span>
                <span>{sec.title}</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-50 shrink-0 ml-1" />
            </button>
          ))}
        </div>
      </div>

      {/* Main Documentation Viewer */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#181818]">
        <div>
          <span className="text-[10px] uppercase font-semibold text-[#58a6ff] tracking-wider">
            {selectedSection.category} &bull; Section {selectedSection.number}
          </span>
          <h1 className="text-xl font-bold text-white mt-1">{selectedSection.title}</h1>
          <p className="text-xs text-[#8b949e] mt-1">{selectedSection.summary}</p>
        </div>

        {/* Content Paragraphs */}
        <div className="space-y-3 text-xs leading-relaxed text-[#c9d1d9] border-t border-[#2d2d2d] pt-4 whitespace-pre-line">
          {selectedSection.content}
        </div>

        {/* Code Example Box */}
        {selectedSection.exampleCode && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-xs flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-[#7ee787]" />
                <span>Runnable Manifest Example</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(selectedSection.exampleCode!)}
                  className="px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded flex items-center gap-1 text-[11px] cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3 h-3 text-[#3fb950]" /> : <Copy className="w-3 h-3" />}
                  <span>Copy</span>
                </button>
                {onLoadExample && (
                  <button
                    onClick={() => onLoadExample(selectedSection.exampleCode!, selectedSection.exampleTarget)}
                    className="px-2 py-1 bg-[#094771] hover:bg-[#0e639c] text-white rounded flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                  >
                    <span>Load in Editor</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <pre className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg font-mono text-xs text-[#7ee787] overflow-x-auto leading-relaxed">
              {selectedSection.exampleCode}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
