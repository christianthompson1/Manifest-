/**
 * Manifest Studio - Project Store & In-Memory Project Management
 * Manages local project files, templates, and storage persistence.
 */

import { ManifestProject, ProjectFile, ProjectTemplate } from './types.ts';
import { get, set } from 'idb-keyval';
import { STARTER_WASM_BYTES, encodeWasmDataUrl } from './execution/wasm-execution-provider.ts';

export interface StudioSettings {
  fontSize: number;
  previewOpen: boolean;
  wordWrap: boolean;
  activeActivityTab: 'explorer' | 'search' | 'git' | 'packages' | 'devtools';
}

export const DEFAULT_SETTINGS: StudioSettings = {
  fontSize: 13,
  previewOpen: true,
  wordWrap: false,
  activeActivityTab: 'explorer',
};

const SETTINGS_KEY = 'manifest_studio_settings_v1';
const IDB_PROJECT_KEY = 'manifest_studio_project_idb_v1';
const IDB_WORKSPACE_KEY = 'manifest_studio_workspace_projects_v1';
const STORAGE_KEY = 'manifest_studio_project_v1';
const STORAGE_WORKSPACE_KEY = 'manifest_studio_workspace_projects_ls_v1';

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'mvm-professional',
    name: 'Manifest v1.0 — Professional (Rust MVM)',
    description: 'Multi-module general-purpose program with structs, enums, capabilities, SHA-256, and Rust MVM (.mbc) execution.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-mvm-pro',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "ledger-engine"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-mvm-pro-main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module main;

requires console, crypto;
denies net;

import { compute_fee } from "./math_utils";

struct TransferBatch {
    sender: str,
    amount: i64,
    fee: i64,
}

enum Settlement {
    Cleared(i64),
    Rejected(str),
}

fn settle(batch: TransferBatch) -> Settlement {
    if batch.amount <= 0 {
        return Settlement::Rejected("non-positive transfer");
    }
    return Settlement::Cleared(batch.amount - batch.fee);
}

fn main() -> i64 effects(console, crypto) {
    let amount: i64 = 2500;
    let fee: i64 = compute_fee(amount, 2);
    let batch = TransferBatch {
        sender: "vault-alpha",
        amount: amount,
        fee: fee,
    };

    let digest: str = std::crypto::sha256(batch.sender);
    console.print("Vault digest: " + std::str::upper(digest));

    let outcome: Settlement = settle(batch);
    match outcome {
        Settlement::Cleared(net_total) => {
            console.print("Net settled: " + std::conv::to_str(net_total));
            return net_total;
        },
        Settlement::Rejected(reason) => {
            console.print("Rejected: " + reason);
            return 0;
        },
    }
}
`,
      },
      {
        id: 'manifest-mvm-pro-utils',
        name: 'math_utils.manifest',
        path: 'src/math_utils.manifest',
        language: 'manifest',
        content: `module math_utils;

export fn compute_fee(amount: i64, bps_percent: i64) -> i64 {
    return (amount * bps_percent) / 100;
}
`,
      },
    ],
  },
  {
    id: 'mvm-beginner',
    name: 'Manifest v1.0 — Beginner Profile (Rust MVM)',
    description: 'Readable keyword-guided syntax lowering to the exact same Typed IR, .mbc bytecode, and Rust MVM as Professional Profile.',
    kind: 'manifest',
    syntaxProfile: 'beginner',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-mvm-beg',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "inventory-scorer"
version = "1.0.0"
entry = "src/main.manifest"
profile = "beginner"
target = "mvm"
`,
      },
      {
        id: 'manifest-mvm-beg-main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `MODULE main

REQUIRES console
DENIES net

FUNCTION score_batch(units: Int, unit_value: Int) RETURNS Int
    LET gross: Int = units * unit_value
    IF gross >= 500
        RETURN gross + 25
    ELSE
        RETURN gross
    END
END

FUNCTION main() RETURNS Int EFFECTS console
    LET MUTABLE total: Int = 0
    LET batches: Array<Int> = [4, 8, 12]

    FOR EACH count IN batches
        SET total = total + score_batch(count, 50)
    END

    SHOW "Total Inventory Score:"
    SHOW total
    RETURN total
END
`,
      },
    ],
  },
  {
    id: 'manifest-wasm-target',
    name: 'Manifest v1.0 — Direct WebAssembly (.wasm)',
    description: 'Compiles numeric Manifest functions directly into standalone W3C WebAssembly (.wasm + .wat) and runs in-browser.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'wasm',
    files: [
      {
        id: 'toml-wasm-target',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "fibonacci-wasm"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "wasm"
`,
      },
      {
        id: 'manifest-wasm-main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module fib_wasm;

requires console;

export fn fib(n: i64) -> i64 {
    if n <= 1 {
        return n;
    }
    let mut a: i64 = 0;
    let mut b: i64 = 1;
    let mut i: i64 = 2;
    while i <= n {
        let next: i64 = a + b;
        a = b;
        b = next;
        i = i + 1;
    }
    return b;
}

export fn main() -> i64 effects(console) {
    let result: i64 = fib(12);
    console.print(result);
    return result;
}
`,
      },
    ],
  },
  {
    id: 'empty',
    name: 'Blank Manifest App',
    description: 'Clean minimal starter template for building a new Manifest v1.0 application.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-empty',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "my-project"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-empty',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module app;

requires console;

fn main() -> i64 effects(console) {
    console.print("Hello World");
    return 0;
}
`,
      },
    ],
  },
  {
    id: 'static-web',
    name: 'Static Web App (HTML/CSS/JS)',
    description: 'First-class web project with index.html, styles.css, app.js, and interactive counter.',
    kind: 'web',
    files: [
      {
        id: 'web-index-html',
        name: 'index.html',
        path: 'index.html',
        language: 'html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive Web App</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="card">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
      <img src="assets/logo.svg" alt="Web Logo" width="32" height="32">
      <h1 id="title" style="margin-bottom:0;">Interactive Web App</h1>
    </div>
    <p class="subtitle">First-class static web project running directly in Manifest Studio.</p>

    <div class="counter-box">
      <span class="label">Count:</span>
      <span id="counter" class="count-value">0</span>
    </div>

    <div class="actions">
      <button id="btn-increment" class="btn primary">Increment</button>
      <button id="btn-reset" class="btn secondary">Reset</button>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
`,
      },
      {
        id: 'web-logo-svg',
        name: 'logo.svg',
        path: 'assets/logo.svg',
        language: 'xml',
        content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#2563eb"/>
  <path d="M18 44V20h6l8 13 8-13h6v24h-6V30l-8 12-8-12v14z" fill="#ffffff"/>
</svg>
`,
      },
      {
        id: 'web-styles-css',
        name: 'styles.css',
        path: 'styles.css',
        language: 'css',
        content: `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: #0f172a;
  color: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  background-color: #1e293b;
  border: 1px solid #334155;
  border-radius: 16px;
  padding: 32px;
  max-width: 480px;
  width: 100%;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
}

h1 {
  font-size: 24px;
  color: #60a5fa;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 13px;
  color: #94a3b8;
  margin-bottom: 24px;
}

.counter-box {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.label {
  font-size: 14px;
  color: #cbd5e1;
}

.count-value {
  font-size: 28px;
  font-weight: 700;
  color: #38bdf8;
  font-family: monospace;
}

.actions {
  display: flex;
  gap: 12px;
}

.btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn.primary {
  background: #2563eb;
  color: #ffffff;
}

.btn.primary:hover {
  background: #1d4ed8;
}

.btn.secondary {
  background: #334155;
  color: #e2e8f0;
}

.btn.secondary:hover {
  background: #475569;
}
`,
      },
      {
        id: 'web-app-js',
        name: 'app.js',
        path: 'app.js',
        language: 'javascript',
        content: `// Interactive Web App Script
let count = 0;

const counterEl = document.getElementById('counter');
const incBtn = document.getElementById('btn-increment');
const resetBtn = document.getElementById('btn-reset');

function updateDisplay() {
  if (counterEl) {
    counterEl.textContent = String(count);
  }
  console.log('[Web App] Current count:', count);
}

if (incBtn) {
  incBtn.addEventListener('click', () => {
    count++;
    updateDisplay();
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    count = 0;
    updateDisplay();
  });
}

console.log('[Web App] Initialized successfully in Manifest Studio Preview');
`,
      },
    ],
  },
  {
    id: 'counter',
    name: 'Counter',
    description: 'Stateful counter module with deterministic bounds checks, helper functions, and Rust MVM execution.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-counter',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "counter"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-counter',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module counter;

requires console;

struct CounterState {
    value: i64,
    step: i64,
}

fn increment(state: CounterState) -> CounterState {
    return CounterState {
        value: state.value + state.step,
        step: state.step,
    };
}

fn reset(state: CounterState) -> CounterState {
    return CounterState {
        value: 0,
        step: state.step,
    };
}

fn main() -> i64 effects(console) {
    let mut state = CounterState { value: 0, step: 1 };
    let mut i: i64 = 0;
    while i < 5 {
        state = increment(state);
        console.print("Count: " + std::conv::to_str(state.value));
        i = i + 1;
    }
    let final_value: i64 = state.value;
    state = reset(state);
    console.print("Reset count: " + std::conv::to_str(state.value));
    return final_value;
}
`,
      },
    ],
  },
  {
    id: 'dashboard',
    name: 'Commerce Dashboard (v1.0)',
    description: 'Analytical commerce ledger computing revenue totals, order metrics, and category summaries.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'web-js',
    files: [
      {
        id: 'toml-dash',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "commerce-dashboard"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "web-js"
`,
      },
      {
        id: 'manifest-dash',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module commerce_dashboard;

requires console;
denies net, fs;

struct MetricCard {
    label: str,
    value: i64,
    delta_percent: i64,
}

fn summarize_metric(card: MetricCard) -> str {
    return card.label + ": " + std::conv::to_str(card.value) + " (delta " + std::conv::to_str(card.delta_percent) + "%)";
}

fn main() -> i64 effects(console) {
    let cards: Array<MetricCard> = [
        MetricCard { label: "Active Users", value: 14892, delta_percent: 18 },
        MetricCard { label: "Net Orders", value: 3420, delta_percent: 12 },
        MetricCard { label: "System Uptime", value: 99, delta_percent: 1 },
    ];

    let mut total: i64 = 0;
    for card in cards {
        console.print(summarize_metric(card));
        total = total + card.value;
    }

    return total;
}
`,
      },
    ],
  },
  {
    id: 'landing',
    name: 'Manifest Official Landing & Ecosystem',
    description: 'Official multi-target language overview in canonical v1.0 .manifest syntax with brand asset references.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'web-js',
    files: [
      {
        id: 'toml-landing',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "manifest-official-landing"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "web-js"
`,
      },
      {
        id: 'manifest-landing',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module manifest_official_landing;

requires console;
denies net, fs;

struct TargetInfo {
    id: str,
    route_label: str,
    status: str,
}

fn describe_target(t: TargetInfo) -> str {
    return t.route_label + " [" + t.id + "]: " + t.status;
}

fn main() -> i64 effects(console) {
    let logo_dark: str = "assets/brand/manifest-logo-dark.svg";
    let wordmark: str = "assets/brand/manifest-wordmark.svg";

    let targets: Array<TargetInfo> = [
        TargetInfo { id: "mvm", route_label: "Home", status: "Implemented (Rust MVM .mbc)" },
        TargetInfo { id: "web-js", route_label: "Docs", status: "Implemented (Capability-Restricted Web JS)" },
        TargetInfo { id: "wasm", route_label: "WASM", status: "Implemented (Standalone W3C .wasm)" },
        TargetInfo { id: "solana-sbf", route_label: "Solana", status: "Implemented (Anchor Rust + IDL)" },
    ];

    console.print("Manifest v1.0 Official Overview");
    console.print("Brand assets: " + logo_dark + ", " + wordmark);

    let mut count: i64 = 0;
    for target in targets {
        console.print(" - " + describe_target(target));
        count = count + 1;
    }

    return count;
}
`,
      },
    ],
  },
  {
    id: 'ecommerce',
    name: 'Order Pricing Engine',
    description: 'Product catalog pricing and discount calculator using structs, enums, and checked arithmetic.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-ecom',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "order-pricing"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-ecom',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module order_pricing;

requires console;

struct LineItem {
    sku: str,
    unit_cents: i64,
    qty: i64,
}

enum CheckoutOutcome {
    TotalCents(i64),
    EmptyCart,
}

fn calculate_subtotal(items: Array<LineItem>) -> CheckoutOutcome {
    if items.length == 0 {
        return CheckoutOutcome::EmptyCart;
    }
    let mut sum: i64 = 0;
    for item in items {
        sum = sum + (item.unit_cents * item.qty);
    }
    return CheckoutOutcome::TotalCents(sum);
}

fn main() -> i64 effects(console) {
    let cart: Array<LineItem> = [
        LineItem { sku: "HEADPHONES-PRO", unit_cents: 19900, qty: 1 },
        LineItem { sku: "USB-C-CABLE", unit_cents: 1500, qty: 2 },
    ];

    match calculate_subtotal(cart) {
        CheckoutOutcome::TotalCents(cents) => {
            console.print("Order total cents: " + std::conv::to_str(cents));
            return cents;
        },
        CheckoutOutcome::EmptyCart => {
            console.print("Cart is empty");
            return 0;
        },
    }
}
`,
      },
    ],
  },
  {
    id: 'solana-dapp',
    name: 'Solana On-Chain Program',
    description: 'Standalone Solana smart contract declared with PROGRAM, ACCOUNT, and REQUIRE constraints compiling to Anchor Rust + IDL JSON.',
    kind: 'solana',
    compilerTarget: 'solana-sbf',
    files: [
      {
        id: 'toml-solana',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "solana-counter-program"
version = "1.0.0"
entry = "src/main.manifest"
target = "solana-sbf"

[capabilities]
solana = true

[solana]
program_id = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
`,
      },
      {
        id: 'manifest-solana',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `PROGRAM CounterProgram
    ACCOUNT CounterState
        count: NUMBER
        authority: ADDRESS
    END

    INSTRUCTION increment
        REQUIRE signer = authority
        SET count = count + 1
    END
END
`,
      },
    ],
  },
  {
    id: 'hello',
    name: 'Hello World (v1.0)',
    description: 'Minimal Manifest v1.0 module writing structured output with declared console capability.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-hello',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "hello-world"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-hello',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module hello_world;

requires console;

fn main() -> i64 effects(console) {
    console.print("Hello, Manifest v1.0!");
    return 0;
}
`,
      },
    ],
  },
  {
    id: 'form',
    name: 'Input Validation Pipeline',
    description: 'Typed form payload validator returning Result values and exhaustive match handling.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-form',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "input-validator"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-form',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module input_validator;

requires console;

struct SignupPayload {
    username: str,
    age: i64,
}

fn validate_signup(payload: SignupPayload) -> Result<str, str> {
    if std::str::len(payload.username) < 3 {
        return Result::Err("Username must be at least 3 characters");
    }
    if payload.age < 13 {
        return Result::Err("Minimum age is 13");
    }
    return Result::Ok("Welcome, " + payload.username + "!");
}

fn main() -> i64 effects(console) {
    let payload = SignupPayload { username: "manifest_dev", age: 21 };
    match validate_signup(payload) {
        Ok(greeting) => {
            console.print(greeting);
            return 1;
        },
        Err(reason) => {
            console.print("Validation failed: " + reason);
            return 0;
        },
    }
}
`,
      },
    ],
  },
  {
    id: 'routes',
    name: 'Multi-Module Dispatch',
    description: 'Multi-file Manifest v1.0 project demonstrating module imports and deterministic dispatch.',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    files: [
      {
        id: 'toml-routes',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "multi-module-dispatch"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-routes',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module router_app;

requires console;

import { resolve_route } from "./routes_table";

fn main() -> i64 effects(console) {
    console.print("GET / -> " + resolve_route("/"));
    console.print("GET /about -> " + resolve_route("/about"));
    return 0;
}
`,
      },
      {
        id: 'manifest-routes-table',
        name: 'routes_table.manifest',
        path: 'src/routes_table.manifest',
        language: 'manifest',
        content: `module routes_table;

export fn resolve_route(path: str) -> str {
    if path == "/" {
        return "HomeHandler";
    }
    if path == "/about" {
        return "AboutHandler";
    }
    return "NotFoundHandler";
}
`,
      },
    ],
  },
  {
    id: 'wasm-module',
    name: 'WebAssembly Binary (.wasm)',
    description: 'Compiled WebAssembly MVP binary module exporting main() -> 42 and add(a, b) with host stdout import.',
    kind: 'wasm',
    files: [
      {
        id: 'wasm-binary-main',
        name: 'module.wasm',
        path: 'module.wasm',
        language: 'wasm',
        isBinary: true,
        mimeType: 'application/wasm',
        content: encodeWasmDataUrl(STARTER_WASM_BYTES),
      },
      {
        id: 'wasm-readme',
        name: 'README.md',
        path: 'README.md',
        language: 'markdown',
        content: `# WebAssembly Binary Execution (.wasm)

This workspace contains a real compiled WebAssembly binary (\`module.wasm\`).

## Exported Functions
- \`add(a: i32, b: i32) -> i32\`: Adds two 32-bit integers.
- \`main() -> i32\`: Computes \`add(20, 22)\`, invokes host import \`env.print_i32(42)\`, and returns \`42\`.

## Capabilities & Boundaries
- Manifest Studio executes compiled \`.wasm\` binaries directly via the host WebAssembly VM (\`WasmExecutionProvider\`).
- General-purpose Manifest v1.0 programs (\`.manifest\`) also compile directly to standalone \`.wasm\` via the **WebAssembly (.wasm)** compiler target, or to portable \`.mbc\` bytecode executed on the **Rust Manifest Virtual Machine**.
`,
      },
    ],
  },
];

export function createBlankProject(): ManifestProject {
  return {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'my-project',
    description: 'Clean minimal starter Manifest v1.0 project',
    kind: 'manifest',
    syntaxProfile: 'professional',
    compilerTarget: 'mvm',
    entryPath: 'src/main.manifest',
    files: [
      {
        id: 'toml-root',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[package]
name = "my-project"
version = "1.0.0"
entry = "src/main.manifest"
profile = "professional"
target = "mvm"
`,
      },
      {
        id: 'manifest-main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `module app;

requires console;

fn main() -> i64 effects(console) {
    console.print("Hello World");
    return 0;
}
`,
      },
    ],
    activeFilePath: 'src/main.manifest',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createDefaultProject(templateId = 'empty'): ManifestProject {
  if (templateId === 'empty' || !templateId) {
    return createBlankProject();
  }
  const tpl = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0];
  const files: ProjectFile[] = tpl.files.map((f) => ({ ...f }));
  const preferredActive =
    files.find((f) => f.path === 'src/main.manifest' || f.path === 'index.html' || f.path.endsWith('.wasm'))?.path ||
    files[0]?.path ||
    'src/main.manifest';

  return {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: tpl.name,
    description: tpl.description,
    kind: tpl.kind || 'manifest',
    syntaxProfile: tpl.syntaxProfile,
    compilerTarget: tpl.compilerTarget,
    entryPath: preferredActive,
    files,
    activeFilePath: preferredActive,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function saveProjectToStorage(project: ManifestProject): { saved: boolean; error?: string } {
  try {
    if (typeof localStorage === 'undefined') {
      return { saved: true };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    try {
      const rawMap = localStorage.getItem(STORAGE_WORKSPACE_KEY);
      const parsedMap: Record<string, ManifestProject> = rawMap ? JSON.parse(rawMap) : {};
      parsedMap[project.id] = project;
      localStorage.setItem(STORAGE_WORKSPACE_KEY, JSON.stringify(parsedMap));
    } catch {
      // Workspace index in localStorage may exceed 5MB if many binary projects exist; IndexedDB handles full workspace
    }
    return { saved: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn('Could not save project to localStorage', err);
    return { saved: false, error: msg };
  }
}

export function loadProjectFromStorage(): ManifestProject {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.files) && parsed.files.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('Could not read project from storage, using default', err);
  }
  return createBlankProject();
}

export async function loadProjectAsync(): Promise<ManifestProject> {
  try {
    const idbData = await get<ManifestProject>(IDB_PROJECT_KEY);
    if (idbData && Array.isArray(idbData.files) && idbData.files.length > 0) {
      return idbData;
    }
  } catch (err) {
    console.warn('Could not read from IndexedDB, trying localStorage fallback', err);
  }

  return loadProjectFromStorage();
}

export async function saveProjectAsync(project: ManifestProject): Promise<{ saved: boolean; error?: string }> {
  const lsResult = saveProjectToStorage(project);
  try {
    await set(IDB_PROJECT_KEY, project);
    const existingMap = (await get<Record<string, ManifestProject>>(IDB_WORKSPACE_KEY)) || {};
    existingMap[project.id] = project;
    await set(IDB_WORKSPACE_KEY, existingMap);
    return { saved: true };
  } catch (err: any) {
    const idbErr = err?.message || String(err);
    console.warn('Could not save to IndexedDB', err);
    return lsResult.saved
      ? { saved: true }
      : { saved: false, error: `Storage persistence failed (IndexedDB: ${idbErr}; localStorage: ${lsResult.error})` };
  }
}

export async function listWorkspaceProjectsAsync(): Promise<ManifestProject[]> {
  try {
    const idbMap = await get<Record<string, ManifestProject>>(IDB_WORKSPACE_KEY);
    if (idbMap && typeof idbMap === 'object') {
      return Object.values(idbMap).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
  } catch {
    // Fall back to localStorage workspace map
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_WORKSPACE_KEY);
      if (raw) {
        const parsed: Record<string, ManifestProject> = JSON.parse(raw);
        return Object.values(parsed).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      }
    }
  } catch {
    // Ignore parse error
  }
  return [];
}

export async function deleteWorkspaceProjectAsync(projectId: string): Promise<void> {
  try {
    const idbMap = (await get<Record<string, ManifestProject>>(IDB_WORKSPACE_KEY)) || {};
    if (projectId in idbMap) {
      delete idbMap[projectId];
      await set(IDB_WORKSPACE_KEY, idbMap);
    }
  } catch {
    // Ignore IDB error
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_WORKSPACE_KEY);
      if (raw) {
        const parsed: Record<string, ManifestProject> = JSON.parse(raw);
        delete parsed[projectId];
        localStorage.setItem(STORAGE_WORKSPACE_KEY, JSON.stringify(parsed));
      }
    }
  } catch {
    // Ignore localStorage error
  }
}

export function loadSettingsFromStorage(): StudioSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    }
  } catch (err) {
    console.warn('Could not load settings', err);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettingsToStorage(settings: StudioSettings): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch (err) {
    console.warn('Could not save settings', err);
  }
}
