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
    description: 'Clean minimal starter template for building a new Manifest application.',
    kind: 'manifest',
    files: [
      {
        id: 'toml-empty',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "my-project"
version = "1.0.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-empty',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "App"

PAGE Home
    TEXT "Hello World"
END
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
    description: 'Interactive counter with reactive state, text binding, and button click mutation.',
    kind: 'manifest',
    files: [
      {
        id: 'toml-counter',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "Counter"
version = "0.4.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-counter',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "Counter"

PAGE Home
    STATE count: NUMBER = 0

    CONTAINER
        LAYOUT FLEX
        DIRECTION COLUMN
        GAP 16
        ALIGN CENTER
        PADDING 24

        TEXT "Current Count: " + count
            STYLE
                FONT_SIZE 24
                FONT_WEIGHT 700
            END

        BUTTON "Increment"
            STYLE
                BACKGROUND "#2563EB"
                COLOR "#FFFFFF"
                PADDING 10 20
                RADIUS 8
            END
            WHEN CLICK
                SET count = count + 1
            END
        END
    END
END
`,
      },
    ],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Analytical dashboard with KPI cards, container layout, and metrics.',
    kind: 'manifest',
    files: [
      {
        id: 'toml-dash',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "MetricsDashboard"
version = "0.4.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-dash',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "MetricsDashboard"

PAGE Home
    HEADER
        TEXT "Analytics & Performance"
            STYLE
                FONT_SIZE 20
                FONT_WEIGHT 700
            END
    END

    CONTAINER
        LAYOUT FLEX
        DIRECTION ROW
        GAP 16
        PADDING 16

        CARD
            TEXT "Active Users"
            TEXT "14,892"
                STYLE
                    FONT_SIZE 28
                    COLOR "#3B82F6"
                    FONT_WEIGHT 700
                END
            BADGE "+18.2% this week"
        END

        CARD
            TEXT "Total Revenue"
            TEXT "$124,500"
                STYLE
                    FONT_SIZE 28
                    COLOR "#10B981"
                    FONT_WEIGHT 700
                END
            BADGE "Goal reached"
        END

        CARD
            TEXT "System Load"
            TEXT "32%"
                STYLE
                    FONT_SIZE 28
                    COLOR "#F59E0B"
                    FONT_WEIGHT 700
                END
            PROGRESS 32
        END
    END
END
`,
      },
    ],
  },
  {
    id: 'landing',
    name: 'Landing Page',
    description: 'Polished responsive product landing page with hero section, animations, and call-to-action.',
    kind: 'manifest',
    files: [
      {
        id: 'toml-landing',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "ProductLanding"
version = "0.4.0"
entry = "src/main.manifest"
target = "js"

[libraries]
framer-motion = "12.0.0"
lucide = "0.546.0"
`,
      },
      {
        id: 'manifest-landing',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "ProductLanding"

USE LIBRARY "framer-motion"
USE LIBRARY "lucide"

PAGE Home
    NAV
        TEXT "Manifest Cloud"
            STYLE
                FONT_WEIGHT 700
                COLOR "#FFFFFF"
            END
        LINK "Features" TO "#"
        LINK "Pricing" TO "#"
        LINK "Docs" TO "#"
    END

    CONTAINER
        LAYOUT FLEX
        DIRECTION COLUMN
        ALIGN CENTER
        GAP 20
        PADDING 60 20

        TEXT "Build Software at the Speed of Thought"
            STYLE
                FONT_SIZE 36
                FONT_WEIGHT 800
                COLOR "#FFFFFF"
            END

        TEXT "The next-generation declarative language for web and Solana on-chain engineering."
            STYLE
                FONT_SIZE 18
                COLOR "#9CA3AF"
            END

        BUTTON "Get Started Free"
            STYLE
                BACKGROUND "#2563EB"
                COLOR "#FFFFFF"
                FONT_SIZE 16
                PADDING 14 32
                RADIUS 10
            END
            ANIMATE
                INITIAL SCALE 0.95
                TO SCALE 1
                DURATION 300
                EASE "easeOut"
            END
            WHEN CLICK
                SHOW "Welcome to the Manifest Platform!"
            END
        END
    END

    FOOTER
        TEXT "© 2026 Manifest Platform Inc. All rights reserved."
    END
END
`,
      },
    ],
  },
  {
    id: 'ecommerce',
    name: 'E-commerce Store',
    description: 'Product catalog with reactive shopping cart counter and styled checkout action.',
    kind: 'manifest',
    files: [
      {
        id: 'toml-ecom',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "MinimalStore"
version = "0.4.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-ecom',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "MinimalStore"

PAGE Home
    STATE cartCount: NUMBER = 0

    HEADER
        TEXT "Concept Store"
            STYLE
                FONT_SIZE 20
                FONT_WEIGHT 700
            END
        TEXT "Cart: " + cartCount + " items"
            STYLE
                COLOR "#10B981"
                FONT_WEIGHT 600
            END
    END

    CONTAINER
        LAYOUT FLEX
        DIRECTION ROW
        GAP 24
        PADDING 20

        CARD
            TEXT "Wireless Studio Headphones"
                STYLE
                    FONT_SIZE 18
                    FONT_WEIGHT 600
                END
            TEXT "$199.00 USD"
                STYLE
                    COLOR "#9CA3AF"
                END
            BUTTON "Add to Cart"
                STYLE
                    BACKGROUND "#10B981"
                    COLOR "#FFFFFF"
                    RADIUS 6
                    PADDING 8 16
                END
                WHEN CLICK
                    SET cartCount = cartCount + 1
                END
            END
        END
    END
END
`,
      },
    ],
  },
  {
    id: 'solana-dapp',
    name: 'Solana dApp',
    description: 'Full-stack Solana on-chain smart contract with Anchor Rust target and web UI.',
    kind: 'solana',
    files: [
      {
        id: 'toml-solana',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "SolanaCounterDApp"
version = "0.4.0"
entry = "src/main.manifest"
target = "solana"

[capabilities]
solana = true
web = true

[solana]
program_id = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
`,
      },
      {
        id: 'manifest-solana',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "SolanaCounterDApp"

USE SOLANA

PROGRAM CounterProgram
    ACCOUNT CounterState
        count: NUMBER
        authority: ADDRESS
    END

    INSTRUCTION increment
        REQUIRE signer = authority
        SET count = count + 1
    END
END

PAGE Home
    STATE onchainCount: NUMBER = 0

    CONTAINER
        LAYOUT FLEX
        DIRECTION COLUMN
        GAP 16
        ALIGN CENTER
        PADDING 32

        TEXT "Solana On-Chain Counter"
            STYLE
                FONT_SIZE 24
                FONT_WEIGHT 700
            END

        TEXT "Simulated Account Balance: 10 SOL"
            STYLE
                COLOR "#9CA3AF"
            END

        TEXT "On-Chain Value: " + onchainCount
            STYLE
                FONT_SIZE 32
                COLOR "#8B5CF6"
                FONT_WEIGHT 800
            END

        BUTTON "Send Transaction (Increment)"
            STYLE
                BACKGROUND "#8B5CF6"
                COLOR "#FFFFFF"
                PADDING 12 24
                RADIUS 8
            END
            WHEN CLICK
                SET onchainCount = onchainCount + 1
                SHOW "Transaction confirmed on Solana cluster"
            END
        END
    END
END
`,
      },
    ],
  },
  {
    id: 'hello',
    name: 'Hello App',
    description: 'Starter application showcasing text presentation, buttons, and startup events.',
    files: [
      {
        id: 'toml-hello',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "HelloApp"
version = "0.2.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-hello',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "HelloApp"

PAGE Home

    TEXT "Hello, World!"
    TEXT "Built with Manifest Application Language v0.2"

    BUTTON "Explore"
        WHEN CLICK
            SHOW "Welcome to Manifest Application Development!"
        END
    END

END
`,
      },
    ],
  },
  {
    id: 'form',
    name: 'Interactive Input & Form',
    description: 'User input binding with INPUT, reactive state, and BUTTON submission.',
    files: [
      {
        id: 'toml-form',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "FormApp"
version = "0.2.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-form',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "FormApp"

PAGE Home

    STATE username TO ""
    STATE greeting TO ""

    TEXT "What is your name?"

    INPUT "Type your name here..." INTO username

    BUTTON "Say Hello"
        WHEN CLICK
            SET greeting TO "Nice to meet you, " + username + "!"
        END
    END

    TEXT greeting

END
`,
      },
    ],
  },
  {
    id: 'routes',
    name: 'Multi-Page & Routes',
    description: 'Application with multiple PAGE declarations and ROUTE paths.',
    files: [
      {
        id: 'toml-routes',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "MultiPageApp"
version = "0.2.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-routes',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "MultiPageApp"

ROUTE "/" TO Home
ROUTE "/about" TO About

PAGE Home ROUTE "/"

    TEXT "Home Dashboard"
    TEXT "Welcome to the primary page."

END

PAGE About ROUTE "/about"

    TEXT "About Page"
    TEXT "Manifest Application Language v0.2 — Foundation"

END
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
    description: 'Clean minimal starter Manifest project',
    kind: 'manifest',
    entryPath: 'src/main.manifest',
    files: [
      {
        id: 'toml-root',
        name: 'manifest.toml',
        path: 'manifest.toml',
        language: 'toml',
        content: `[app]
name = "my-project"
version = "0.4.0"
entry = "src/main.manifest"
target = "js"
`,
      },
      {
        id: 'manifest-main',
        name: 'main.manifest',
        path: 'src/main.manifest',
        language: 'manifest',
        content: `APP "App"

PAGE Home
    TEXT "Hello World"
END
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
