# Manifest Package & Dependency Management Specification

**Status:** Normative Specification — Manifest v1.0 / Phase 5  
**Core Implementation:** `manifest-core/src/package/`  
**Studio Integration:** `src/studio/sidebar/Sidebar.tsx` (Packages View)  
**CLI Tooling:** `manifest-core/src/cli.ts` (`manifest package`, `manifest add`, `manifest remove`)

---

## 1. Package Architecture Overview

Manifest projects declare dependencies, compiler targets, entry modules, and capability grants in a versioned `manifest.toml` configuration file. A deterministic lockfile (`manifest.lock`) records exact resolved versions and SHA-256 integrity checksums to ensure bit-for-bit reproducible builds across environments.

```
project-root/
├── manifest.toml          # Authoritative package manifest
├── manifest.lock          # Deterministic dependency graph & SHA-256 checksums
├── src/
│   └── main.manifest      # Module entry point
└── build/                 # Compiler artifacts (.mbc, .wasm, .js)
```

---

## 2. Manifest Format (`manifest.toml`)

The package manifest follows standard TOML format:

```toml
[package]
name = "my-service"
version = "0.1.0"
description = "High-performance microservice in Manifest"
authors = ["Manifest Developer <dev@manifest.lang>"]
license = "MIT"
entry = "src/main.manifest"

[dependencies]
std-core = "^1.0.0"
std-math = "^1.0.0"
json = "^1.0.0"

[dev-dependencies]
std-collections = "^1.0.0"

[capabilities]
console = true
net = false
fs.read = true
```

### Field Definitions

| Section | Key | Type | Description |
|---|---|---|---|
| `[package]` | `name` | string | Package name (lowercase, alphanumeric, `-`, `_`). |
| `[package]` | `version` | string | Semantic Version (SemVer 2.0.0 `X.Y.Z`). |
| `[package]` | `description` | string | Brief description of package functionality. |
| `[package]` | `authors` | array | List of package authors. |
| `[package]` | `license` | string | SPDX license identifier (e.g. `MIT`, `Apache-2.0`). |
| `[package]` | `entry` | string | Primary entry module file path (default: `src/main.manifest`). |
| `[dependencies]` | `<name>` | string | Runtime dependency version requirement (e.g. `^1.0.0`, `~1.2.0`, `1.0.0`). |
| `[dev-dependencies]` | `<name>` | string | Test-only or tooling dependencies. |
| `[capabilities]` | `<name>` | boolean | Explicit capability grant declarations for the module. |

---

## 3. Semantic Versioning & Constraint Rules

The Manifest dependency resolver implements SemVer 2.0.0 specification with standard constraint operators:

| Operator | Syntax Example | Meaning | Matching Range |
|---|---|---|---|
| **Caret (`^`)** | `^1.2.3` | Compatible update within major version | `>= 1.2.3, < 2.0.0` (zero major: `^0.2.3` matches `>= 0.2.3, < 0.3.0`) |
| **Tilde (`~`)** | `~1.2.3` | Patch-level update within minor version | `>= 1.2.3, < 1.3.0` |
| **Exact** | `1.2.3` | Exact version pin | `= 1.2.3` |
| **Wildcard** | `*` | Any available version | All versions |
| **Inequality** | `>=1.0.0, <2.0.0` | Explicit version bounds | Satisfies all comma-separated clauses |

---

## 4. Lockfile Format (`manifest.lock`)

The lockfile stores a complete, flat graph of all directly declared and transitively resolved packages:

```json
{
  "version": 1,
  "packages": {
    "json": {
      "version": "1.2.0",
      "source": "registry",
      "dependencies": {
        "std-core": "^1.0.0"
      },
      "integrity": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
    },
    "std-core": {
      "version": "1.1.0",
      "source": "std",
      "dependencies": {},
      "integrity": "sha256:4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
    }
  }
}
```

### Deterministic Properties
1. **Sorted Keys**: Package names are serialized in alphabetical order.
2. **Cryptographic Checksum**: `integrity` contains a `sha256:` prefix followed by the lowercase hex hash of the package contents and version metadata.
3. **Reproducibility**: Running `manifest verify` compares current lockfile hashes with package source hashes, rejecting tampered dependencies.

---

## 5. Dependency Resolution Pipeline

The `DependencyResolver` (`manifest-core/src/package/dependency-resolver.ts`) enforces:

1. **Cycle Detection (`E_CIRCULAR_DEPENDENCY`)**:
   - Traverses dependency graph with active path tracking.
   - If `A -> B -> A` cycle is encountered, resolution fails cleanly with detailed cycle chain report.

2. **Conflict Detection (`E_DEPENDENCY_CONFLICT`)**:
   - If package `X` requires `Z @ ^1.0.0` and package `Y` requires `Z @ ^2.0.0`, the resolver identifies the conflict and halts with clear error diagnostics.

3. **Transitive Resolution**:
   - Recursively resolves all child dependencies until a closed graph is formed.

---

## 6. Official Catalog & Standard Libraries

The official package catalog (`OFFICIAL_PACKAGE_REGISTRY`) provides core building blocks:

| Package | Source | Capabilities Required | Description |
|---|---|---|---|
| `std-core` | `std` | None (pure) | Core assertions, primitives, and identity functions. |
| `std-math` | `std` | None (pure) | Pure language mathematical operations (`abs`, `min`, `max`, `sqrt`). |
| `std-collections` | `std` | None (pure) | Dynamic arrays, sets, and map helpers. |
| `json` | `registry` | None (pure) | JSON serialization and deserialization. |
| `http` | `registry` | `net` | HTTP client transport and URL utilities. |
| `crypto` | `registry` | `crypto` | Cryptographic digests (SHA-256) and hashing. |

---

## 7. CLI Commands

```bash
# Initialize a new package with default manifest.toml
manifest package init [name]

# List declared dependencies and lock status
manifest package list

# Verify package configuration and lockfile checksum integrity
manifest package verify

# Add a dependency to manifest.toml and update manifest.lock
manifest add <pkg-name> [version-constraint]

# Remove a dependency from manifest.toml and re-resolve manifest.lock
manifest remove <pkg-name>
```

---

## 8. Manifest Studio Integration

The **Packages & Standard Library** tab in the Studio Activity Rail (`src/studio/sidebar/Sidebar.tsx`) connects the UI directly to `PackageManager`:
- **Interactive Manifest Initialization**: Generates valid `manifest.toml` with one click if not present.
- **Live Dependency Management**: Visual dependency cards with version badges, lock status, and one-click removal.
- **Official Registry Browser**: Quick-add buttons for official standard and ecosystem packages.
- **Cryptographic Integrity Verification**: Live verification button checking SHA-256 checksums with visual status banner.
- **Standard Library Explorer**: Interactive documentation browser for all `std::*` modules (`std::core`, `std::result`, `std::math`, `std::string`, `std::collections`, `std::io`, `std::fs`, `std::net`, `std::time`, `std::crypto`) with capability badges and one-click import copying.
