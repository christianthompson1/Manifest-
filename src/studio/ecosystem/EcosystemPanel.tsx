/**
 * Manifest Studio - Ecosystem, Frameworks, Libraries & Target Configuration Panel
 * (src/studio/ecosystem/EcosystemPanel.tsx)
 *
 * Implements the official developer ecosystem discovery workspace:
 * - Domain-specific framework catalog (Web, Backend, Solana/Blockchain, Systems/Native, Games)
 * - Honest capability maturity (Implemented, Partially Implemented, Experimental, Planned, Unsupported)
 * - Compiler Target configuration matrix (MVM, Web-JS, WASM, Native, Solana SBF, EVM, Move, TON)
 * - Package and standard library explorer with reproducible lockfile integrity
 */

import React, { useState } from 'react';
import {
  Boxes,
  Globe,
  Server,
  Coins,
  Cpu,
  Gamepad2,
  Layers,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Copy,
  Check,
  Search,
  BookOpen,
  Terminal,
  ShieldCheck,
  ArrowRight,
  Code2,
} from 'lucide-react';
import { COMPILER_TARGETS, CompilerTargetSpec } from '../../../manifest-core/src/targets/target-registry.ts';
import { OFFICIAL_PACKAGE_REGISTRY } from '../../../manifest-core/src/package/package-manager.ts';
import { StdLibraryRegistry } from '../../../manifest-core/src/stdlib/std-modules.ts';
import { ManifestProject } from '../types.ts';

export type DomainCategory = 'all' | 'web' | 'backend' | 'solana' | 'systems' | 'games';

interface EcosystemItem {
  id: string;
  name: string;
  domain: 'web' | 'backend' | 'solana' | 'systems' | 'games';
  type: 'framework' | 'library' | 'integration' | 'toolchain';
  status: 'implemented' | 'partially-implemented' | 'experimental' | 'planned';
  description: string;
  version: string;
  targets: string[];
  manifestImport: string;
  docsAnchor?: string;
  details: string;
}

const ECOSYSTEM_CATALOG: EcosystemItem[] = [
  // Web Development
  {
    id: 'manifest-web',
    name: 'Manifest Web Framework',
    domain: 'web',
    type: 'framework',
    status: 'implemented',
    description: 'Component architecture with fine-grained reactive state signals, keyed Virtual DOM reconciliation, and SPA routing.',
    version: '1.0.0',
    targets: ['web-js'],
    manifestImport: 'requires [dom]; APP "App Name"; PAGE Home ...',
    details: 'Supports keyed list reconciliation, onMount/onDestroy lifecycle hooks, CircularDependencyError loop protection, and two-way form models.',
  },
  {
    id: 'manifest-forms',
    name: 'Manifest Form Validation Engine',
    domain: 'web',
    type: 'library',
    status: 'implemented',
    description: 'Two-way bound form models with dirty/touched states and declarative validation rules (required, minLength, pattern, numeric).',
    version: '1.0.0',
    targets: ['web-js'],
    manifestImport: 'FormField, FormModel, Validators',
    details: 'Synchronous validation with accessible error state reporting and dirty field tracking.',
  },
  {
    id: 'manifest-styles',
    name: 'Scoped CSS & Responsive Styles',
    domain: 'web',
    type: 'library',
    status: 'implemented',
    description: 'Scoped CSS class synthesis (m-style-xxxx), CSS custom properties, and responsive media query breakpoint helpers.',
    version: '1.0.0',
    targets: ['web-js'],
    manifestImport: 'createScopedStyle, createGlobalTheme, breakpoint',
    details: 'Zero-overhead CSS class generation with automatic DOM stylesheet injection.',
  },
  {
    id: 'manifest-auth',
    name: 'Manifest Web Auth & Session',
    domain: 'web',
    type: 'library',
    status: 'planned',
    description: 'Client session storage, JWT verification, and OAuth provider integrations.',
    version: '0.1.0-planned',
    targets: ['web-js'],
    manifestImport: 'import { Session } from "std::auth";',
    details: 'Planned client-side session management with capability-gated browser storage.',
  },

  // Backend Development
  {
    id: 'manifest-http-server',
    name: 'Manifest HTTP Server',
    domain: 'backend',
    type: 'framework',
    status: 'implemented',
    description: 'Asynchronous HTTP server binding real OS sockets with route dispatch, parameter extraction, streaming JSON, and middleware chains.',
    version: '1.0.0',
    targets: ['mvm', 'native'],
    manifestImport: 'requires [net]; import { ManifestHttpServer } from "manifest-server";',
    details: 'Tested with real TCP socket listeners, 413 payload limits, 504 request timeouts, and graceful shutdown.',
  },
  {
    id: 'manifest-db',
    name: 'Database Connector & SQL Driver',
    domain: 'backend',
    type: 'integration',
    status: 'partially-implemented',
    description: 'Database driver abstraction with connection pooling and query builders. Browser sandbox reports driver unavailable honestly.',
    version: '0.5.0',
    targets: ['mvm', 'native'],
    manifestImport: 'requires [net, storage]; import { DatabaseDriver } from "std::db";',
    details: 'Driver interfaces and capability checks ready; raw TCP database socket proxy for browser sandbox is currently under development.',
  },
  {
    id: 'manifest-workers',
    name: 'Background Worker Queues',
    domain: 'backend',
    type: 'library',
    status: 'planned',
    description: 'Task scheduler and background job worker queues with fuel-isolated execution.',
    version: '0.1.0-planned',
    targets: ['mvm', 'native'],
    manifestImport: 'import { WorkerPool } from "std::workers";',
    details: 'Planned multi-threaded worker model running independent MVM instances with message passing.',
  },

  // Solana & Blockchain
  {
    id: 'manifest-solana-ir',
    name: 'Manifest Solana Smart Contract Pipeline',
    domain: 'solana',
    type: 'framework',
    status: 'implemented',
    description: 'On-chain program and instruction definitions, account schemas, signer constraints, and checked arithmetic.',
    version: '1.0.0',
    targets: ['solana-sbf'],
    manifestImport: 'requires [solana]; PROGRAM EscrowVault ...',
    details: 'Parses contract declarations, verifies account models, and calculates exact dynamic account space.',
  },
  {
    id: 'anchor-generator',
    name: 'Anchor Rust & IDL Generator',
    domain: 'solana',
    type: 'toolchain',
    status: 'implemented',
    description: 'Compiles Manifest contract IR to verified Anchor 0.30+ Rust code, checked arithmetic, PDA constraints, and IDL JSON.',
    version: '1.0.0',
    targets: ['solana-sbf'],
    manifestImport: 'AnchorGenerator.generate(solanaProgramIR)',
    details: 'Generates production-grade Anchor programs ready for SBF compilation via Solana CLI.',
  },
  {
    id: 'litesvm-runner',
    name: 'In-Process LiteSVM Execution & Security Suite',
    domain: 'solana',
    type: 'integration',
    status: 'implemented',
    description: 'Executes real transactions, airdrops, and system transfers on in-process Solana VM. Rejects unauthorized signers and overdrafts.',
    version: '1.5.0',
    targets: ['solana-sbf'],
    manifestImport: 'LiteSVMRunner.runTestSuite(program)',
    details: 'Accurate compute unit measurement, VM logs, and negative constraint verification.',
  },
  {
    id: 'solana-sbf-ci',
    name: 'Solana SBF CI Build Workflow',
    domain: 'solana',
    type: 'toolchain',
    status: 'implemented',
    description: 'Pinned GitHub Actions workflow (.github/workflows/solana-sbf-build.yml) compiling Anchor Rust to deployable .so ELF binary.',
    version: '1.18.26',
    targets: ['solana-sbf'],
    manifestImport: 'cargo-build-sbf / anchor build in CI',
    details: 'Provides reproducible SBF builds using pinned Solana CLI (v1.18.26) and Anchor (v0.30.1).',
  },
  {
    id: 'native-manifest-sbf',
    name: 'Direct Manifest-to-SBF Backend',
    domain: 'solana',
    type: 'toolchain',
    status: 'planned',
    description: 'Direct emission of SBF ELF binaries from Typed MIR without requiring an Anchor Rust intermediate compiler.',
    version: '0.1.0-planned',
    targets: ['solana-sbf'],
    manifestImport: 'manifest build --target solana-sbf',
    details: 'Long-term compiler objective; currently uses verified Anchor Rust generation.',
  },

  // Other Blockchain Targets
  {
    id: 'evm-solidity',
    name: 'Solidity / EVM Target',
    domain: 'solana',
    type: 'toolchain',
    status: 'planned',
    description: 'Planned compilation target lowering Manifest smart-contract modules to EVM bytecode and Solidity artifacts.',
    version: '0.1.0-planned',
    targets: ['evm-solidity'],
    manifestImport: 'manifest build --target evm-solidity',
    details: 'Registered in target registry; compiler raises E_TARGET_PLANNED.',
  },

  // Systems & Native
  {
    id: 'mvm-core',
    name: 'Rust Manifest Virtual Machine (MVM)',
    domain: 'systems',
    type: 'framework',
    status: 'implemented',
    description: 'Native Rust bytecode runtime executing .mbc v1.0 containers with fuel limits, call depth guards, and capability checks.',
    version: '1.0.0',
    targets: ['mvm'],
    manifestImport: 'cargo run -p mvm-cli -- run module.mbc',
    details: 'Compiles to native CLI and WebAssembly (mvm-wasm); passes Collatz(27) 6-way cross-target conformance.',
  },
  {
    id: 'native-rust-target',
    name: 'Standalone Rust Source Generator',
    domain: 'systems',
    type: 'toolchain',
    status: 'implemented',
    description: 'Lowers Typed Manifest IR into memory-safe standalone Rust source (build/*.rs) for host rustc compilation.',
    version: '1.0.0',
    targets: ['native'],
    manifestImport: 'manifest build --target native',
    details: 'Emits valid standalone Rust; machine binary generation requires host rustc in environment.',
  },

  // Game Development
  {
    id: 'manifest-canvas-2d',
    name: 'Manifest 2D Canvas Engine',
    domain: 'games',
    type: 'framework',
    status: 'experimental',
    description: 'Immediate-mode and retained 2D canvas drawing routines with sprite batching and coordinate transforms.',
    version: '0.4.0',
    targets: ['web-js'],
    manifestImport: 'requires [dom]; import { Canvas2D } from "std::canvas";',
    details: 'Functional prototype rendering 2D geometry and sprites at 60 FPS in browser canvas.',
  },
  {
    id: 'manifest-game-loop',
    name: 'Fixed-Tick Game Loop & Input API',
    domain: 'games',
    type: 'library',
    status: 'experimental',
    description: 'Deterministic delta-time game loop with keyboard, mouse, and gamepad event polling.',
    version: '0.4.0',
    targets: ['web-js', 'mvm'],
    manifestImport: 'import { GameLoop, Input } from "std::game";',
    details: 'Provides requestAnimationFrame ticker with fixed-timestep physics accumulation.',
  },
];

interface EcosystemPanelProps {
  project?: ManifestProject;
  onSelectTarget?: (targetId: string) => void;
  onOpenDoc?: (topic: string) => void;
  onShowToast?: (msg: string) => void;
  onLoadExample?: (code: string, targetPath?: string) => void;
}

export const EcosystemPanel: React.FC<EcosystemPanelProps> = ({
  project,
  onSelectTarget,
  onOpenDoc,
  onShowToast,
  onLoadExample,
}) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'targets' | 'packages'>('catalog');
  const [domainFilter, setDomainFilter] = useState<DomainCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredItems = ECOSYSTEM_CATALOG.filter((item) => {
    const matchesDomain = domainFilter === 'all' || item.domain === domainFilter;
    const matchesSearch =
      !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDomain && matchesSearch;
  });

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    if (onShowToast) onShowToast('Copied Manifest code reference');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusBadge = (status: EcosystemItem['status']) => {
    switch (status) {
      case 'implemented':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#133820] text-[#7ee787] border border-[#238636]/40 font-medium">Implemented</span>;
      case 'partially-implemented':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#382d13] text-[#f2cc60] border border-[#9e6a03]/40 font-medium">Partial</span>;
      case 'experimental':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f283d] text-[#79c0ff] border border-[#1f6feb]/40 font-medium">Experimental</span>;
      case 'planned':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d] font-medium">Planned</span>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181818] text-[#cccccc] select-none text-xs">
      {/* Top Header & Tab Switcher */}
      <div className="p-3 border-b border-[#2d2d2d] bg-[#1f1f1f] flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-white text-sm">
            <Boxes className="w-4 h-4 text-[#58a6ff]" />
            <span>Developer Ecosystem</span>
          </div>
          <span className="text-[10px] text-[#8b949e] bg-[#2d2d2d] px-2 py-0.5 rounded">
            Manifest v1.0
          </span>
        </div>

        {/* View Switcher: Frameworks & Libraries | Compiler Targets | Stdlib Packages */}
        <div className="flex border-b border-[#2d2d2d] gap-1">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-3 py-1.5 font-medium cursor-pointer border-b-2 transition ${
              activeTab === 'catalog'
                ? 'border-[#58a6ff] text-white'
                : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            Frameworks & Libraries
          </button>
          <button
            onClick={() => setActiveTab('targets')}
            className={`px-3 py-1.5 font-medium cursor-pointer border-b-2 transition ${
              activeTab === 'targets'
                ? 'border-[#58a6ff] text-white'
                : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            Compiler Targets
          </button>
          <button
            onClick={() => setActiveTab('packages')}
            className={`px-3 py-1.5 font-medium cursor-pointer border-b-2 transition ${
              activeTab === 'packages'
                ? 'border-[#58a6ff] text-white'
                : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            Standard Modules
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'catalog' && (
          <>
            {/* Search and Domain Filters */}
            <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between">
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#6e7681]" />
                <input
                  type="text"
                  placeholder="Filter frameworks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#161b22] border border-[#30363d] rounded pl-8 pr-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#58a6ff]"
                />
              </div>

              {/* Domain Chips */}
              <div className="flex items-center gap-1 overflow-x-auto text-[11px] pb-1 w-full sm:w-auto">
                {(['all', 'web', 'backend', 'solana', 'systems', 'games'] as DomainCategory[]).map((dom) => (
                  <button
                    key={dom}
                    onClick={() => setDomainFilter(dom)}
                    className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap capitalize transition ${
                      domainFilter === dom
                        ? 'bg-[#30363d] text-white font-medium border border-[#8b949e]/40'
                        : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'
                    }`}
                  >
                    {dom === 'all' ? 'All Domains' : dom}
                  </button>
                ))}
              </div>
            </div>

            {/* Catalog Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#1c1c1c] border border-[#2d2d2d] rounded-lg p-3.5 flex flex-col justify-between hover:border-[#388bfd]/50 transition"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        {item.domain === 'web' && <Globe className="w-4 h-4 text-[#58a6ff]" />}
                        {item.domain === 'backend' && <Server className="w-4 h-4 text-[#4ade80]" />}
                        {item.domain === 'solana' && <Coins className="w-4 h-4 text-[#a78bfa]" />}
                        {item.domain === 'systems' && <Cpu className="w-4 h-4 text-[#38bdf8]" />}
                        {item.domain === 'games' && <Gamepad2 className="w-4 h-4 text-[#f43f5e]" />}
                        <span className="font-semibold text-white text-xs">{item.name}</span>
                      </div>
                      {getStatusBadge(item.status)}
                    </div>

                    <p className="text-[11px] text-[#8b949e] line-clamp-2 mb-2.5">{item.description}</p>

                    <div className="p-2 bg-[#141414] rounded border border-[#262626] font-mono text-[10px] text-[#7ee787] flex items-center justify-between">
                      <span className="truncate">{item.manifestImport}</span>
                      <button
                        onClick={() => handleCopyCode(item.id, item.manifestImport)}
                        className="text-[#8b949e] hover:text-white shrink-0 ml-1.5 p-0.5"
                        title="Copy syntax"
                      >
                        {copiedId === item.id ? <Check className="w-3 h-3 text-[#3fb950]" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-[#262626] text-[10px] text-[#6e7681]">
                    <span>Targets: {item.targets.join(', ')}</span>
                    <span className="font-mono">v{item.version}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Compiler Targets Matrix Tab */}
        {activeTab === 'targets' && (
          <div className="space-y-3">
            <div className="p-3 bg-[#1c1c1c] border border-[#2d2d2d] rounded-lg text-xs text-[#8b949e]">
              <span className="font-semibold text-white">Compiler Target Architecture:</span> Manifest
              lowers canonical Typed Intermediate Representation (MIR) to dedicated platform backends.
              Status and required toolchains are verified below.
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {COMPILER_TARGETS.map((target) => (
                <div
                  key={target.id}
                  className="bg-[#1c1c1c] border border-[#2d2d2d] rounded-lg p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="space-y-1 max-w-xl">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white text-sm">{target.name}</span>
                      <span className="text-[10px] font-mono bg-[#141414] px-1.5 py-0.5 rounded text-[#58a6ff]">
                        --target {target.id}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          target.status === 'available'
                            ? 'bg-[#133820] text-[#7ee787]'
                            : target.status === 'available-with-limitations'
                            ? 'bg-[#382d13] text-[#f2cc60]'
                            : target.status === 'requires-toolchain'
                            ? 'bg-[#1f283d] text-[#79c0ff]'
                            : 'bg-[#21262d] text-[#8b949e]'
                        }`}
                      >
                        {target.status}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#8b949e]">{target.description}</p>

                    {target.limitations.length > 0 && (
                      <p className="text-[10px] text-[#f2cc60] italic">
                        Note: {target.limitations.join(' ')}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-start md:items-end gap-1.5 shrink-0">
                    <span className="text-[10px] text-[#6e7681]">
                      Outputs: {target.artifactExtensions.join(', ')}
                    </span>
                    {onSelectTarget && target.canRunInStudio && (
                      <button
                        onClick={() => onSelectTarget(target.id)}
                        className="px-2.5 py-1 bg-[#094771] hover:bg-[#0e639c] text-white rounded text-[11px] font-medium cursor-pointer"
                      >
                        Select in Studio
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Standard Library Registry Tab */}
        {activeTab === 'packages' && (
          <div className="space-y-3">
            <div className="p-3 bg-[#1c1c1c] border border-[#2d2d2d] rounded-lg text-xs text-[#8b949e]">
              <span className="font-semibold text-white">Standard Library Architecture:</span> Standard modules
              resolve virtually via <code className="text-[#58a6ff]">import &#123; ... &#125; from "std::*";</code>.
              Sensitive modules are capability-gated.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {StdLibraryRegistry.getInstance().listModules().map((mod) => {
                const exportMatches = Array.from(
                  mod.source.matchAll(/\bpub\s+(?:fn|enum|struct|const)\s+([a-zA-Z0-9_]+)/g)
                ).map((m) => m[1]);
                const sampleImports = exportMatches.slice(0, 2).join(', ') || '*';
                return (
                <div
                  key={mod.name}
                  className="bg-[#1c1c1c] border border-[#2d2d2d] rounded-lg p-3 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[#58a6ff] font-semibold text-xs">{mod.name}</span>
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                          mod.capabilities && mod.capabilities.length > 0 ? 'bg-[#382d13] text-[#f2cc60]' : 'bg-[#133820] text-[#7ee787]'
                        }`}
                      >
                        {mod.capabilities && mod.capabilities.length > 0 ? `requires [${mod.capabilities.join(', ')}]` : 'pure'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8b949e] line-clamp-2 mb-2">{mod.description}</p>
                  </div>

                  <div className="pt-2 border-t border-[#262626] flex items-center justify-between text-[10px] text-[#6e7681]">
                    <span>{exportMatches.length} exports</span>
                    <button
                      onClick={() => handleCopyCode(mod.name, `import { ${sampleImports} } from "${mod.name}";`)}
                      className="text-[#58a6ff] hover:underline"
                    >
                      Copy import
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
