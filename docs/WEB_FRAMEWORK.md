# Manifest Web Application Framework (Phase 6)

The Manifest Web Application Framework provides a declarative, reactive, and capability-hardened frontend development system implemented entirely in the native Manifest compiler pipeline and Web/JS runtime.

## Core Capabilities

1. **Virtual DOM Architecture**:
   - `h(tag, props, ...children)` creates structured VNodes with attributes, styles, and event listeners.
   - Component composition with props, children, and keyed reconciliation for lists.
   - `renderVNodeToDOM(vnode)` lowers VNodes directly into real DOM elements.
   - `mountManifestApp(container, rootComponent)` mounts interactive apps with `requestAnimationFrame` batching.

2. **Fine-Grained Reactive State**:
   - `createState<T>(initial)` creates reactive signal primitives supporting `.value`, `.update(fn)`, and `.subscribe(listener)`.
   - `computed<T>(fn)` creates derived signals with automatic dependency tracking. When referenced states change, derived signals automatically recalculate without manual subscription management.

3. **Typed Browser Events**:
   - Event normalization for `onClick`, `onInput`, `onChange`, `onSubmit`, `onKeyDown`, `onFocus`, and `onBlur`.
   - Synthetic event binding with automatic bubbling prevention and form control synchronization.

4. **Client-Side SPA Router**:
   - `createRouter({ routes, mode, fallbackComponent })` provides single-page application routing.
   - Supports both `hash` (`#/...`) and `history` HTML5 navigation modes.
   - Dynamic route parameter matching (e.g. `/users/:id` extracts `id`).
   - Query string parser and reactive `currentRoute` state.
   - Navigation guards via `canActivate: () => boolean`.

5. **Typed Form Validation**:
   - `FormField<T>` wraps form inputs with validation rules and dirty/touched tracking.
   - `Validators.required()`, `Validators.minLength(n)`, `Validators.email()`, and `Validators.pattern(regex)`.
   - `FormModel` validates all fields simultaneously and provides sanitized values for submission.

6. **Scoped Dynamic Styling**:
   - `createScopedStyle(cssBody)` hashes and injects CSS rules with unique `.m-style-xxxx` classes into the document stylesheet.
   - Prevents selector leakage across components while avoiding runtime CSS-in-JS bloat.

7. **Capability-Gated Host Integration**:
   - Modules declare capabilities in source:
     ```manifest
     module my_web_app;
     requires net, ui;
     ```
   - HTTP `fetch` requires `net` capability. Unauthorized attempts raise `CapabilityDenied`.
   - Persistent storage (`localStorage` / `sessionStorage`) requires `storage` or `fs` capability.
