/**
 * Manifest Studio - Project Store & In-Memory Project Management
 * Manages local project files, templates, and storage persistence.
 */

import { ManifestProject, ProjectFile, ProjectTemplate } from './types.ts';
import { get, set } from 'idb-keyval';

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
const STORAGE_KEY = 'manifest_studio_project_v1';

export const TEMPLATES: ProjectTemplate[] = [
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
version = "0.4.0"
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
];

export function createBlankProject(): ManifestProject {
  return {
    id: `project-${Date.now()}`,
    name: 'my-project',
    description: 'Clean minimal starter Manifest project',
    kind: 'manifest',
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

  return {
    id: `project-${Date.now()}`,
    name: tpl.name,
    description: tpl.description,
    kind: tpl.kind || 'manifest',
    files,
    activeFilePath: files[0]?.path || 'src/main.manifest',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function saveProjectToStorage(project: ManifestProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (err) {
    console.warn('Could not save project to localStorage', err);
  }
}

export function loadProjectFromStorage(): ManifestProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.files) && parsed.files.length > 0) {
        return parsed;
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

export async function saveProjectAsync(project: ManifestProject): Promise<void> {
  // Sync to both localStorage (instant synchronous) and IndexedDB (robust offline storage)
  saveProjectToStorage(project);
  try {
    await set(IDB_PROJECT_KEY, project);
  } catch (err) {
    console.warn('Could not save to IndexedDB', err);
  }
}

export function loadSettingsFromStorage(): StudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn('Could not load settings', err);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettingsToStorage(settings: StudioSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Could not save settings', err);
  }
}
