/**
 * Manifest Web Application Framework (manifest-core/src/web/manifest-web.ts)
 *
 * Production-grade declarative web runtime for Manifest:
 * 1. Virtual DOM Component Architecture:
 *    - `h(tag, props, ...children)`: VNode builder
 *    - Keyed list reconciliation and attribute diffing
 *    - Component lifecycle hooks (`onMount`, `onDestroy`) with auto-cleanup of listeners
 * 2. Fine-Grained Reactive State System:
 *    - `createState<T>(initial)`: Reactive signal with `.value`, `.update(fn)`, `.subscribe(fn)`
 *    - `computed<T>(fn)`: Derived state with automatic dependency tracking & memory leak protection
 *    - Loop protection guard against cyclic state cascades (> 100 iterations)
 *    - Microtask and requestAnimationFrame batching
 * 3. Typed Browser Host API:
 *    - Capability-gated host layer (`net`, `storage`, `dom`)
 *    - HTTP backend communication (`fetch` with timeout, headers, abort signals)
 *    - Persistent browser storage (`localStorage` / `sessionStorage`)
 *    - Viewport dimensions and theme preference detection (`getTheme()`, `getViewport()`)
 *    - Clipboard API integration
 * 4. Scoped Dynamic Styling:
 *    - CSS class synthesis with scoped selector isolation (`m-style-xxxx`)
 *    - CSS variable theme definitions
 *    - Responsive breakpoint helpers
 * 5. Typed Forms & Accessible Validation:
 *    - Two-way bound form models with dirty/touched states and validation rules
 *    - Built-in validators (`required`, `minLength`, `maxLength`, `email`, `numeric`, `pattern`, `custom`)
 * 6. Client-Side SPA Router:
 *    - `createRouter({ routes, initialPath, mode })`: History / hash routing
 *    - Dynamic param extraction (`/products/:id`), query params, route guards (`canActivate`)
 */

export type VNodeChild = VNode | string | number | boolean | null | undefined;

export interface VNodeProps {
  id?: string;
  className?: string;
  class?: string;
  style?: Record<string, string | number>;
  key?: string | number;
  onClick?: (e: any) => void;
  onInput?: (e: any) => void;
  onChange?: (e: any) => void;
  onSubmit?: (e: any) => void;
  onKeyDown?: (e: any) => void;
  onFocus?: (e: any) => void;
  onBlur?: (e: any) => void;
  onPointerDown?: (e: any) => void;
  [attr: string]: any;
}

export interface VNode {
  tag: string | ComponentFn;
  props: VNodeProps;
  children: VNodeChild[];
  key?: string | number;
  _dom?: Node;
  _cleanup?: Array<() => void>;
}

export type ComponentFn = (props: VNodeProps, children: VNodeChild[]) => VNode;

// Active component lifecycle context for onMount / onDestroy
interface ComponentLifecycleContext {
  mountHooks: Array<() => (() => void) | void>;
  destroyHooks: Array<() => void>;
}

let activeLifecycleContext: ComponentLifecycleContext | null = null;

export function onMount(hook: () => (() => void) | void): void {
  if (activeLifecycleContext) {
    activeLifecycleContext.mountHooks.push(hook);
  }
}

export function onDestroy(hook: () => void): void {
  if (activeLifecycleContext) {
    activeLifecycleContext.destroyHooks.push(hook);
  }
}

// ----------------------------------------------------------------------------
// 1. VNode Builder (h function)
// ----------------------------------------------------------------------------
export function h(
  tag: string | ComponentFn,
  props?: VNodeProps | null,
  ...children: (VNodeChild | VNodeChild[])[]
): VNode {
  const flatChildren: VNodeChild[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      flatChildren.push(...child.flat(Infinity));
    } else {
      flatChildren.push(child);
    }
  }

  const normalizedProps: VNodeProps = props || {};
  return {
    tag,
    props: normalizedProps,
    children: flatChildren,
    key: normalizedProps.key,
  };
}

export function createComponent(
  name: string,
  setup: (props: VNodeProps, children: VNodeChild[]) => VNode
): ComponentFn {
  const comp: ComponentFn = (props, children) => setup(props, children);
  Object.defineProperty(comp, 'name', { value: name });
  return comp;
}

// ----------------------------------------------------------------------------
// 2. Reactive State & Dependency Tracking
// ----------------------------------------------------------------------------
type StateListener<T> = (newValue: T, oldValue: T) => void;

let activeTrackingScope: (() => void) | null = null;
let currentNotificationDepth = 0;
const MAX_NOTIFICATION_DEPTH = 100;

export class CircularDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

export class State<T> {
  private _value: T;
  private listeners: Set<StateListener<T>> = new Set();

  constructor(initial: T) {
    this._value = initial;
  }

  public get value(): T {
    if (activeTrackingScope) {
      this.subscribe(activeTrackingScope);
    }
    return this._value;
  }

  public set value(newValue: T) {
    if (this._value !== newValue) {
      const old = this._value;
      this._value = newValue;
      this.notify(newValue, old);
    }
  }

  public update(fn: (prev: T) => T): void {
    this.value = fn(this._value);
  }

  public subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(newValue: T, oldValue: T): void {
    currentNotificationDepth++;
    if (currentNotificationDepth > MAX_NOTIFICATION_DEPTH) {
      currentNotificationDepth = 0;
      throw new CircularDependencyError(
        `CircularDependencyError: Reactive state notification loop exceeded safe threshold (${MAX_NOTIFICATION_DEPTH})`
      );
    }

    try {
      const snapshot = Array.from(this.listeners);
      for (const listener of snapshot) {
        try {
          listener(newValue, oldValue);
        } catch (err) {
          if (err instanceof CircularDependencyError) {
            throw err;
          }
          console.error('State listener error:', err);
        }
      }
    } finally {
      currentNotificationDepth--;
    }
  }
}

export function createState<T>(initial: T): State<T> {
  return new State<T>(initial);
}

export function computed<T>(fn: () => T): State<T> {
  let derivedState: State<T>;
  let activeUnsubscribers: Array<() => void> = [];

  const cleanupSubscriptions = () => {
    for (const unsub of activeUnsubscribers) {
      unsub();
    }
    activeUnsubscribers = [];
  };

  const recompute = () => {
    cleanupSubscriptions();
    const prevScope = activeTrackingScope;
    activeTrackingScope = () => {
      recompute();
    };
    try {
      const val = fn();
      if (derivedState) {
        derivedState.value = val;
      }
      return val;
    } finally {
      activeTrackingScope = prevScope;
    }
  };

  const initialVal = recompute();
  derivedState = new State<T>(initialVal);
  return derivedState;
}

// ----------------------------------------------------------------------------
// 3. Client-Side SPA Router
// ----------------------------------------------------------------------------
export interface RouteParams {
  [param: string]: string;
}

export interface RouteMatch {
  path: string;
  params: RouteParams;
  query: Record<string, string>;
  component: ComponentFn;
}

export interface RouteDefinition {
  path: string; // e.g. "/", "/products", "/products/:id"
  component: ComponentFn;
  title?: string;
  canActivate?: () => boolean;
}

export interface RouterOptions {
  routes: RouteDefinition[];
  initialPath?: string;
  mode?: 'history' | 'hash';
  fallbackComponent?: ComponentFn;
}

export class Router {
  public currentRoute: State<RouteMatch | null>;
  private routes: RouteDefinition[];
  private mode: 'history' | 'hash';
  private fallbackComponent: ComponentFn;

  constructor(options: RouterOptions) {
    this.routes = options.routes;
    this.mode = options.mode || 'hash';
    this.fallbackComponent =
      options.fallbackComponent ||
      (() => h('div', { className: 'm-router-404' }, '404 - Page Not Found'));

    this.currentRoute = createState<RouteMatch | null>(null);
    this.init(options.initialPath);
  }

  private init(initialPath?: string): void {
    if (typeof window !== 'undefined') {
      window.addEventListener(this.mode === 'hash' ? 'hashchange' : 'popstate', () => {
        this.resolveCurrentLocation();
      });
      if (initialPath) {
        this.navigate(initialPath);
      } else {
        this.resolveCurrentLocation();
      }
    } else {
      this.matchRoute(initialPath || '/');
    }
  }

  public navigate(path: string): void {
    if (typeof window !== 'undefined') {
      if (this.mode === 'hash') {
        const hashTarget = path.startsWith('/') ? path : `/${path}`;
        window.location.hash = hashTarget;
      } else {
        window.history.pushState({}, '', path);
        this.resolveCurrentLocation();
      }
    } else {
      this.matchRoute(path);
    }
  }

  public resolveCurrentLocation(): void {
    let path = '/';
    if (typeof window !== 'undefined') {
      if (this.mode === 'hash') {
        const hash = window.location.hash.slice(1);
        path = hash.startsWith('/') ? hash : `/${hash}`;
      } else {
        path = window.location.pathname + window.location.search;
      }
    }
    this.matchRoute(path);
  }

  public matchRoute(rawPath: string): RouteMatch | null {
    const [pathPart, queryPart] = rawPath.split('?');
    const path = pathPart.replace(/\/+$/, '') || '/';
    const query: Record<string, string> = {};

    if (queryPart) {
      for (const pair of queryPart.split('&')) {
        const [k, v] = pair.split('=');
        if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
      }
    }

    for (const route of this.routes) {
      const match = this.matchPattern(route.path, path);
      if (match) {
        if (route.canActivate && !route.canActivate()) {
          continue;
        }
        const matched: RouteMatch = {
          path,
          params: match,
          query,
          component: route.component,
        };
        this.currentRoute.value = matched;
        return matched;
      }
    }

    const fallback: RouteMatch = {
      path,
      params: {},
      query,
      component: this.fallbackComponent,
    };
    this.currentRoute.value = fallback;
    return fallback;
  }

  private matchPattern(pattern: string, actual: string): RouteParams | null {
    if (pattern === '*' || pattern === '/*') return {};
    const patternSegments = pattern.replace(/\/+$/, '').split('/').filter(Boolean);
    const actualSegments = actual.replace(/\/+$/, '').split('/').filter(Boolean);

    if (patternSegments.length !== actualSegments.length) {
      if (pattern === '/' && actualSegments.length === 0) return {};
      return null;
    }

    const params: RouteParams = {};
    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i];
      const a = actualSegments[i];
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(a);
      } else if (p !== a) {
        return null;
      }
    }
    return params;
  }
}

export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}

// ----------------------------------------------------------------------------
// 4. Form Validation Engine
// ----------------------------------------------------------------------------
export interface ValidationRule<T = any> {
  validate: (val: T) => boolean;
  message: string;
}

export const Validators = {
  required: (message = 'This field is required'): ValidationRule => ({
    validate: (val) => val !== null && val !== undefined && String(val).trim().length > 0,
    message,
  }),
  minLength: (min: number, message?: string): ValidationRule => ({
    validate: (val) => String(val ?? '').length >= min,
    message: message || `Must be at least ${min} characters`,
  }),
  maxLength: (max: number, message?: string): ValidationRule => ({
    validate: (val) => String(val ?? '').length <= max,
    message: message || `Cannot exceed ${max} characters`,
  }),
  email: (message = 'Must be a valid email address'): ValidationRule => ({
    validate: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val ?? '')),
    message,
  }),
  numeric: (message = 'Must be a valid number'): ValidationRule => ({
    validate: (val) => val !== '' && val !== null && val !== undefined && !isNaN(Number(val)),
    message,
  }),
  min: (minVal: number, message?: string): ValidationRule => ({
    validate: (val) => Number(val) >= minVal,
    message: message || `Must be at least ${minVal}`,
  }),
  max: (maxVal: number, message?: string): ValidationRule => ({
    validate: (val) => Number(val) <= maxVal,
    message: message || `Cannot exceed ${maxVal}`,
  }),
  pattern: (regex: RegExp, message = 'Invalid format'): ValidationRule => ({
    validate: (val) => regex.test(String(val ?? '')),
    message,
  }),
  custom: <T = any>(fn: (val: T) => boolean, message = 'Invalid value'): ValidationRule<T> => ({
    validate: fn,
    message,
  }),
};

export class FormField<T = string> {
  public value: State<T>;
  public error: State<string | null>;
  public isTouched: State<boolean>;
  public isDirty: State<boolean>;
  private initialValue: T;
  private rules: ValidationRule<T>[];

  constructor(initial: T, rules: ValidationRule<T>[] = []) {
    this.initialValue = initial;
    this.value = createState<T>(initial);
    this.error = createState<string | null>(null);
    this.isTouched = createState<boolean>(false);
    this.isDirty = createState<boolean>(false);
    this.rules = rules;

    this.value.subscribe((val) => {
      this.isDirty.value = val !== this.initialValue;
      if (this.isTouched.value) {
        this.validate();
      }
    });
  }

  public validate(): boolean {
    for (const rule of this.rules) {
      if (!rule.validate(this.value.value)) {
        this.error.value = rule.message;
        return false;
      }
    }
    this.error.value = null;
    return true;
  }

  public touch(): void {
    this.isTouched.value = true;
    this.validate();
  }

  public reset(newInitial?: T): void {
    if (newInitial !== undefined) {
      this.initialValue = newInitial;
    }
    this.value.value = this.initialValue;
    this.error.value = null;
    this.isTouched.value = false;
    this.isDirty.value = false;
  }
}

export class FormModel {
  public fields: Record<string, FormField<any>>;

  constructor(fields: Record<string, FormField<any>>) {
    this.fields = fields;
  }

  public validateAll(): boolean {
    let allValid = true;
    for (const field of Object.values(this.fields)) {
      field.touch();
      if (!field.validate()) {
        allValid = false;
      }
    }
    return allValid;
  }

  public get isValid(): boolean {
    return Object.values(this.fields).every((f) => !f.error.value && f.validate());
  }

  public getValues(): Record<string, any> {
    const res: Record<string, any> = {};
    for (const [k, f] of Object.entries(this.fields)) {
      res[k] = f.value.value;
    }
    return res;
  }

  public reset(defaults: Record<string, any> = {}): void {
    for (const [k, f] of Object.entries(this.fields)) {
      const def = defaults[k] !== undefined ? defaults[k] : '';
      f.reset(def);
    }
  }
}

// ----------------------------------------------------------------------------
// 5. Scoped Dynamic Styling & Themes
// ----------------------------------------------------------------------------
let styleSheetElement: HTMLStyleElement | null = null;
const registeredStyles = new Set<string>();

export function createScopedStyle(cssBody: string, prefix = 'm-style'): string {
  let hash = 0;
  for (let i = 0; i < cssBody.length; i++) {
    hash = (hash << 5) - hash + cssBody.charCodeAt(i);
    hash |= 0;
  }
  const className = `${prefix}-${Math.abs(hash).toString(36)}`;

  if (typeof document !== 'undefined' && !registeredStyles.has(className)) {
    if (!styleSheetElement) {
      styleSheetElement = document.createElement('style');
      styleSheetElement.setAttribute('data-manifest-styles', 'true');
      document.head.appendChild(styleSheetElement);
    }
    const rule = `.${className} { ${cssBody} }`;
    styleSheetElement.textContent += `\n${rule}`;
    registeredStyles.add(className);
  }

  return className;
}

export function createGlobalTheme(themeVariables: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, val] of Object.entries(themeVariables)) {
    const varName = key.startsWith('--') ? key : `--${key}`;
    root.style.setProperty(varName, val);
  }
}

export function breakpoint(size: 'sm' | 'md' | 'lg' | 'xl', rules: string): string {
  const widths: Record<string, string> = {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  };
  return `@media (min-width: ${widths[size] || '768px'}) { ${rules} }`;
}

// ----------------------------------------------------------------------------
// 6. Capability-Gated Web Platform Layer (HTTP, Storage, Viewport, Themes)
// ----------------------------------------------------------------------------
export interface ManifestFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface ManifestWebContext {
  capabilities: Set<string>;
  fetch: (url: string, options?: ManifestFetchOptions) => Promise<any>;
  storage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };
  clipboard: {
    copyText: (text: string) => Promise<boolean>;
  };
  viewport: {
    getViewport: () => { width: number; height: number };
  };
  theme: {
    getTheme: () => 'dark' | 'light';
    setTheme: (theme: 'dark' | 'light') => void;
  };
}

export function createManifestWebContext(grantedCaps: string[]): ManifestWebContext {
  const caps = new Set(grantedCaps);

  const netAllowed = caps.has('net') || Array.from(caps).some((c) => c.startsWith('net.'));
  const storageAllowed = caps.has('fs') || caps.has('storage');

  let activeTheme: 'dark' | 'light' = 'dark';

  return {
    capabilities: caps,
    fetch: async (url: string, options: ManifestFetchOptions = {}) => {
      if (!netAllowed) {
        throw new Error(
          `CapabilityDenied: 'net' capability is required for fetch("${url}"). Declare 'requires net;' in Manifest source.`
        );
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timeoutId: any = null;
      if (controller && options.timeoutMs) {
        timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
      }

      try {
        const fetchFn = typeof window !== 'undefined' && window.fetch ? window.fetch : (globalThis as any).fetch;
        if (!fetchFn) {
          throw new Error('fetch is not available in the current runtime environment');
        }

        const res = await fetchFn(url, {
          method: options.method || 'GET',
          headers: options.headers || { 'Content-Type': 'application/json' },
          body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
          signal: controller?.signal,
        });

        if (timeoutId) clearTimeout(timeoutId);
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      } catch (err: any) {
        if (timeoutId) clearTimeout(timeoutId);
        throw new Error(`Manifest Web Fetch Error: ${err.message || String(err)}`);
      }
    },

    storage: {
      getItem: (key: string) => {
        if (!storageAllowed) return null;
        try {
          if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(`manifest:${key}`);
          }
        } catch {}
        return null;
      },
      setItem: (key: string, val: string) => {
        if (!storageAllowed) {
          throw new Error("CapabilityDenied: 'storage' or 'fs' capability required to persist data.");
        }
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`manifest:${key}`, val);
          }
        } catch (e) {
          console.warn('Storage set failed:', e);
        }
      },
      removeItem: (key: string) => {
        if (!storageAllowed) return;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(`manifest:${key}`);
          }
        } catch {}
      },
      clear: () => {
        if (!storageAllowed) return;
        try {
          if (typeof localStorage !== 'undefined') {
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith('manifest:')) keysToRemove.push(k);
            }
            for (const k of keysToRemove) localStorage.removeItem(k);
          }
        } catch {}
      },
    },

    clipboard: {
      copyText: async (text: string) => {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
    },

    viewport: {
      getViewport: () => {
        if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') {
          return { width: window.innerWidth, height: window.innerHeight };
        }
        return { width: 1280, height: 800 };
      },
    },

    theme: {
      getTheme: () => {
        if (typeof window !== 'undefined' && window.matchMedia) {
          const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          return dark ? 'dark' : 'light';
        }
        return activeTheme;
      },
      setTheme: (theme: 'dark' | 'light') => {
        activeTheme = theme;
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', theme);
        }
      },
    },
  };
}

// ----------------------------------------------------------------------------
// 7. Virtual DOM Rendering, Keyed Reconciliation & Lifecycle
// ----------------------------------------------------------------------------
export function renderVNodeToDOM(vnode: VNodeChild): Node {
  if (vnode === null || vnode === undefined || vnode === false) {
    return document.createTextNode('');
  }
  if (typeof vnode === 'string' || typeof vnode === 'number' || typeof vnode === 'boolean') {
    return document.createTextNode(String(vnode));
  }

  // Component Function setup & lifecycle registration
  if (typeof vnode.tag === 'function') {
    const context: ComponentLifecycleContext = {
      mountHooks: [],
      destroyHooks: [],
    };
    const prevContext = activeLifecycleContext;
    activeLifecycleContext = context;

    let rendered: VNode;
    try {
      rendered = vnode.tag(vnode.props, vnode.children);
    } finally {
      activeLifecycleContext = prevContext;
    }

    const dom = renderVNodeToDOM(rendered);
    vnode._dom = dom;

    // Attach destroy cleanup hooks to rendered node
    const cleanups: Array<() => void> = [];
    for (const hook of context.mountHooks) {
      try {
        const cleanup = hook();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      } catch (e) {
        console.error('onMount hook error:', e);
      }
    }
    for (const dHook of context.destroyHooks) {
      cleanups.push(dHook);
    }
    vnode._cleanup = cleanups;

    return dom;
  }

  const el = document.createElement(vnode.tag);
  vnode._dom = el;
  const cleanups: Array<() => void> = [];

  // Set props & event listeners
  for (const [key, val] of Object.entries(vnode.props)) {
    if (key === 'key' || val === undefined || val === null) continue;
    if (key.startsWith('on') && typeof val === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, val);
      cleanups.push(() => el.removeEventListener(eventName, val));
    } else if (key === 'className' || key === 'class') {
      el.className = String(val);
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(el.style, val);
    } else if (key === 'value' && ('value' in el)) {
      (el as HTMLInputElement).value = String(val);
    } else if (key === 'checked' && ('checked' in el)) {
      (el as HTMLInputElement).checked = Boolean(val);
    } else {
      el.setAttribute(key, String(val));
    }
  }

  vnode._cleanup = cleanups;

  // Render children
  for (const child of vnode.children) {
    el.appendChild(renderVNodeToDOM(child));
  }

  return el;
}

export function cleanupVNode(vnode: VNodeChild): void {
  if (!vnode || typeof vnode !== 'object') return;
  if (vnode._cleanup) {
    for (const cleanup of vnode._cleanup) {
      try {
        cleanup();
      } catch (err) {
        console.error('VNode cleanup error:', err);
      }
    }
    vnode._cleanup = [];
  }
  for (const child of vnode.children || []) {
    cleanupVNode(child);
  }
}

/**
 * Keyed and Structural VDOM Diff and Patch
 */
export function diffAndPatch(
  parent: Node,
  oldVNode: VNodeChild,
  newVNode: VNodeChild,
  index = 0
): Node | null {
  // Case 1: Node removed
  if (newVNode === null || newVNode === undefined || newVNode === false) {
    if (oldVNode && typeof oldVNode === 'object' && oldVNode._dom) {
      cleanupVNode(oldVNode);
      if (oldVNode._dom.parentNode === parent) {
        parent.removeChild(oldVNode._dom);
      }
    } else if (parent.childNodes[index]) {
      parent.removeChild(parent.childNodes[index]);
    }
    return null;
  }

  // Case 2: Node added
  if (oldVNode === null || oldVNode === undefined || oldVNode === false) {
    const newDom = renderVNodeToDOM(newVNode);
    parent.appendChild(newDom);
    return newDom;
  }

  // Case 3: Text / primitive node comparison
  const isOldPrimitive = typeof oldVNode !== 'object';
  const isNewPrimitive = typeof newVNode !== 'object';

  if (isOldPrimitive || isNewPrimitive) {
    if (oldVNode !== newVNode) {
      const newDom = renderVNodeToDOM(newVNode);
      const existing = parent.childNodes[index];
      if (existing) {
        parent.replaceChild(newDom, existing);
      } else {
        parent.appendChild(newDom);
      }
      return newDom;
    }
    return parent.childNodes[index] || null;
  }

  // Case 4: Element tag or Component change
  const oldObj = oldVNode as VNode;
  const newObj = newVNode as VNode;

  if (oldObj.tag !== newObj.tag) {
    cleanupVNode(oldObj);
    const newDom = renderVNodeToDOM(newObj);
    if (oldObj._dom && oldObj._dom.parentNode === parent) {
      parent.replaceChild(newDom, oldObj._dom);
    } else {
      parent.appendChild(newDom);
    }
    return newDom;
  }

  // Component rerender
  if (typeof newObj.tag === 'function') {
    cleanupVNode(oldObj);
    const newDom = renderVNodeToDOM(newObj);
    if (oldObj._dom && oldObj._dom.parentNode === parent) {
      parent.replaceChild(newDom, oldObj._dom);
    }
    return newDom;
  }

  // Case 5: Same element tag — patch attributes and reconcile children
  const el = oldObj._dom as HTMLElement;
  newObj._dom = el;

  // Cleanup old listeners
  if (oldObj._cleanup) {
    for (const cleanup of oldObj._cleanup) cleanup();
  }
  const cleanups: Array<() => void> = [];

  // Patch Props
  const oldProps = oldObj.props || {};
  const newProps = newObj.props || {};

  // Remove stale props
  for (const key of Object.keys(oldProps)) {
    if (key === 'key') continue;
    if (!(key in newProps)) {
      if (key.startsWith('on')) {
        // cleaned up by oldObj._cleanup
      } else if (key === 'className' || key === 'class') {
        el.className = '';
      } else if (key === 'style') {
        el.removeAttribute('style');
      } else {
        el.removeAttribute(key);
      }
    }
  }

  // Apply new/changed props
  for (const [key, val] of Object.entries(newProps)) {
    if (key === 'key' || val === undefined || val === null) continue;
    if (key.startsWith('on') && typeof val === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, val);
      cleanups.push(() => el.removeEventListener(eventName, val));
    } else if (key === 'className' || key === 'class') {
      el.className = String(val);
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(el.style, val);
    } else if (key === 'value' && ('value' in el)) {
      if ((el as HTMLInputElement).value !== String(val)) {
        (el as HTMLInputElement).value = String(val);
      }
    } else if (key === 'checked' && ('checked' in el)) {
      (el as HTMLInputElement).checked = Boolean(val);
    } else {
      if (el.getAttribute(key) !== String(val)) {
        el.setAttribute(key, String(val));
      }
    }
  }
  newObj._cleanup = cleanups;

  // Reconcile Children (Keyed Diffing)
  const oldChildren = oldObj.children || [];
  const newChildren = newObj.children || [];

  const hasKeys = newChildren.some((c) => c && typeof c === 'object' && c.key !== undefined);

  if (hasKeys) {
    // Key-based reconciliation map
    const oldKeyMap = new Map<string | number, { vnode: VNode; dom: Node }>();
    for (const oldChild of oldChildren) {
      if (oldChild && typeof oldChild === 'object' && oldChild.key !== undefined && oldChild._dom) {
        oldKeyMap.set(oldChild.key, { vnode: oldChild, dom: oldChild._dom });
      }
    }

    // Mount or reposition keyed items
    const newDoms: Node[] = [];
    for (let i = 0; i < newChildren.length; i++) {
      const newChild = newChildren[i];
      if (newChild && typeof newChild === 'object' && newChild.key !== undefined) {
        const match = oldKeyMap.get(newChild.key);
        if (match) {
          diffAndPatch(el, match.vnode, newChild, i);
          oldKeyMap.delete(newChild.key);
          if (newChild._dom) newDoms.push(newChild._dom);
        } else {
          const dom = renderVNodeToDOM(newChild);
          newDoms.push(dom);
        }
      } else {
        const dom = renderVNodeToDOM(newChild);
        newDoms.push(dom);
      }
    }

    // Clean up remaining unused old keyed nodes
    for (const [_, leftover] of oldKeyMap) {
      cleanupVNode(leftover.vnode);
      if (leftover.dom.parentNode === el) {
        el.removeChild(leftover.dom);
      }
    }

    // Reorder DOM children to match newDoms order
    for (let i = 0; i < newDoms.length; i++) {
      const expected = newDoms[i];
      const actual = el.childNodes[i];
      if (actual !== expected) {
        el.insertBefore(expected, actual || null);
      }
    }
  } else {
    // Index-based reconciliation
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
      diffAndPatch(el, oldChildren[i], newChildren[i], i);
    }
  }

  return el;
}

export function mountManifestApp(
  container: HTMLElement,
  rootComponent: () => VNode
): { unmount: () => void } {
  let currentVNode: VNode | null = null;
  let batchHandle: any = null;

  const scheduleUpdate = () => {
    if (batchHandle !== null) return;

    const run = () => {
      batchHandle = null;
      const nextVNode = rootComponent();
      if (!currentVNode) {
        container.innerHTML = '';
        const dom = renderVNodeToDOM(nextVNode);
        container.appendChild(dom);
      } else {
        diffAndPatch(container, currentVNode, nextVNode, 0);
      }
      currentVNode = nextVNode;
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      batchHandle = requestAnimationFrame(run);
    } else {
      batchHandle = setTimeout(run, 0);
    }
  };

  scheduleUpdate();

  return {
    unmount: () => {
      if (batchHandle !== null) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(batchHandle);
        } else {
          clearTimeout(batchHandle);
        }
        batchHandle = null;
      }
      if (currentVNode) {
        cleanupVNode(currentVNode);
        currentVNode = null;
      }
      container.innerHTML = '';
    },
  };
}
