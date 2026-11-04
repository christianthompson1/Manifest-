# Manifest Security, Capability & Sandboxing Model — Version 1.0

**Implementation Reference:**
- Compile-time verifier: `manifest-core/src/semantics/capability-analyzer.ts`
- Bytecode verifier & runtime gate: `mvm/crates/mvm-core/src/verifier.rs`, `capability.rs`
- Web JS capability sandbox: `manifest-core/src/targets/web-js-target.ts`
- Studio iframe isolation: `src/studio/preview/PreviewPanel.tsx`

---

## 1. Threat Model & Core Guarantees

Manifest is designed on the **Principle of Least Authority (PoLA)** across four defense-in-depth layers:

1. **Layer 1 — Static Transitive Capability & Effect Verification (`manifest-core`)**: Source modules cannot compile if they invoke—directly or transitively across any call chain—an undeclared or explicitly denied host capability.
2. **Layer 2 — Binary `.mbc` Static Verification (`mvm-core/src/verifier.rs`)**: Hand-crafted or untrusted `.mbc` bytecode is statically verified for stack-height consistency, jump instruction boundaries, operand table bounds, and `requires`/`denies` non-contradiction before execution begins.
3. **Layer 3 — Rust MVM Runtime Capability Policy (`mvm-core/src/capability.rs`)**: Every `HOST_CALL` instruction checks the intersection of module-declared `requires` (minus `denies`) and **host-granted capabilities** (`--cap` in CLI or Studio runtime configuration). Memory safety is guaranteed by `#![forbid(unsafe_code)]` in `mvm-core` plus deterministic step, call-depth, and heap-object limits.
4. **Layer 4 — Browser Preview & Web JS Sandboxing (`PreviewPanel.tsx` & `web-js-target.ts`)**: All web previews execute inside `<iframe sandbox="allow-scripts">` **without** `allow-same-origin`, preventing access to parent DOM, IndexedDB, `localStorage`, cookies, or parent navigation.

---

## 2. Static Capability & Effect Rules

### 2.1 Module-Level Declarations
```manifest
module payment_auditor;

requires [console, crypto];
provides [audit_service];
denies [net, fs.write];
```
- **`requires`**: Capabilities the module requests from its host runtime. Prefix matching applies (`requires [fs]` authorizes `fs.read` and `fs.write`; `requires [fs.read]` does **not** authorize `fs.write`).
- **`provides`**: Logical capability tags exported by this module for architectural auditing.
- **`denies`**: Hard negative guarantee. If `denies [net]` is present, neither this module nor any function imported into it may perform `net` operations (`E_CAP_DENIED`). Overlapping `requires` and `denies` fails immediately (`E_CAP_CONFLICT`).

### 2.2 Transitive Function Effect Propagation
`analyzeCapabilitiesAndEffects()` builds the module call graph `G = (V, E)` and computes the least fixed point:
```
effects(f) = direct_effects(f) ∪ ⋃_{g ∈ callees(f)} effects(g)
```
- If `fn helper()` calls `fs.write_text(...)`, `effects(helper)` contains `fs.write`.
- If `fn process()` calls `helper()`, `effects(process)` automatically acquires `fs.write`.
- If `process` is annotated `fn process() effects(console)` (or `effects(pure)`), compilation fails with `E_EFFECT_VIOLATION` naming the transitive `fs.write` effect!

---

## 3. Runtime Capability Enforcement

Compile-time checks alone are insufficient when executing precompiled `.mbc` binaries or running untrusted code in restricted environments:

| Scenario | Compile-Time Result | Rust MVM Runtime Result |
|---|---|---|
| Source calls `net.get` without `requires [net]` | **Rejected** (`E_CAP_UNDECLARED`) | N/A |
| Source declares `requires [net]` & `denies [net]` | **Rejected** (`E_CAP_CONFLICT`) | **Rejected** (`VerifyError`) |
| Valid `.mbc` has `requires [fs.write]`, run with `mvm run prog.mbc` (host only grants `console`) | Compiled OK | **Traps at `HOST_CALL`** (`VmTrapKind::CapabilityDenied`) |
| Valid `.mbc` has `requires [fs.write]`, run with `mvm run prog.mbc --cap console --cap fs.write` | Compiled OK | **Allowed** |
| Infinite loop `while true {}` in `.mbc` | Compiled OK | **Traps deterministically** at `max_steps` (`StepLimitExceeded`) |

---

## 4. Browser Studio & Network Proxy Security

1. **Strict Null-Origin Preview (`<iframe sandbox="allow-scripts">`)**: Preview code runs in an opaque origin isolated from the Manifest Studio host origin. Communication uses structured `window.postMessage` payloads filtered by message type.
2. **Web-JS Network Lockdown**: When compiling a v1.0 module to `web-js` without the `net` capability, `compileMIRToWebJS` injects an immediate runtime guard disabling `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` before module code runs.
3. **Server-Side Secret Isolation (`server.ts`)**: `HELIUS_API_KEY` is read exclusively in the Express backend (`/api/solana/rpc`) and is never exposed in `VITE_*` client environment variables.
