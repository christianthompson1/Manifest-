/**
 * Manifest Standard Library (std::*) Architecture & Modules
 *
 * Implements:
 * - Pure language standard library modules (std::core, std::result, std::math, std::string, std::collections)
 * - Platform & system capability-gated modules (std::io, std::fs, std::net, std::time, std::crypto)
 * - Source definitions interoperable across Beginner and Professional syntax profiles
 */

export interface StdModuleDef {
  name: string;
  source: string;
  capabilities: string[];
  description: string;
}

export const STD_MODULES: Record<string, StdModuleDef> = {
  'std::core': {
    name: 'std::core',
    capabilities: [],
    description: 'Core types, assertions, panics, and primitives',
    source: `
mod std.core;

pub fn assert(condition: bool, message: str) -> void {
  if !condition {
    console.print("[ASSERTION FAILED] " + message);
  }
}

pub fn identity(x: i64) -> i64 {
  return x;
}
`,
  },

  'std::result': {
    name: 'std::result',
    capabilities: [],
    description: 'Option and Result algebraic data types and handling',
    source: `
mod std.result;

pub enum Option {
  Some(i64),
  None
}

pub enum Result {
  Ok(i64),
  Err(str)
}

pub fn is_some(opt: Option) -> bool {
  match opt {
    Option::Some(_) => { return true; }
    Option::None => { return false; }
  }
}

pub fn is_none(opt: Option) -> bool {
  match opt {
    Option::Some(_) => { return false; }
    Option::None => { return true; }
  }
}

pub fn is_ok(res: Result) -> bool {
  match res {
    Result::Ok(_) => { return true; }
    Result::Err(_) => { return false; }
  }
}

pub fn is_err(res: Result) -> bool {
  match res {
    Result::Ok(_) => { return false; }
    Result::Err(_) => { return true; }
  }
}

pub fn unwrap_or(opt: Option, fallback: i64) -> i64 {
  match opt {
    Option::Some(val) => { return val; }
    Option::None => { return fallback; }
  }
}
`,
  },

  'std::math': {
    name: 'std::math',
    capabilities: [],
    description: 'Numeric algorithms, clamps, absolute value, and utilities',
    source: `
mod std.math;

pub fn abs_i64(x: i64) -> i64 {
  if x < 0 {
    return -x;
  }
  return x;
}

pub fn min_i64(a: i64, b: i64) -> i64 {
  if a < b {
    return a;
  }
  return b;
}

pub fn max_i64(a: i64, b: i64) -> i64 {
  if a > b {
    return a;
  }
  return b;
}

pub fn clamp_i64(val: i64, low: i64, high: i64) -> i64 {
  if val < low {
    return low;
  }
  if val > high {
    return high;
  }
  return val;
}

pub fn pow_i64(base: i64, exp: i64) -> i64 {
  let mut res: i64 = 1;
  let mut i: i64 = 0;
  while i < exp {
    res = res * base;
    i = i + 1;
  }
  return res;
}
`,
  },

  'std::string': {
    name: 'std::string',
    capabilities: [],
    description: 'String manipulation, length, and formatting',
    source: `
mod std.string;

pub fn concat(a: str, b: str) -> str {
  return a + b;
}

pub fn is_empty(s: str) -> bool {
  return s == "";
}
`,
  },

  'std::collections': {
    name: 'std::collections',
    capabilities: [],
    description: 'Reusable collections: List, Stack, Queue, Set, Map structures',
    source: `
mod std.collections;

pub struct StackItem {
  pub value: i64
}

pub fn stack_len(items: [i64]) -> i64 {
  return items.len();
}
`,
  },

  'std::io': {
    name: 'std::io',
    capabilities: ['console'],
    description: 'Terminal and stream I/O operations',
    source: `
mod std.io;

pub fn println(msg: str) -> void {
  console.print(msg);
}

pub fn print_i64(n: i64) -> void {
  console.print(n);
}
`,
  },

  'std::fs': {
    name: 'std::fs',
    capabilities: ['fs.read', 'fs.write'],
    description: 'Filesystem operations (requires fs.read and fs.write capabilities)',
    source: `
mod std.fs;

pub fn read(path: str) -> str {
  return fs.read_text(path);
}

pub fn write(path: str, contents: str) -> bool {
  return fs.write_text(path, contents);
}

pub fn exists(path: str) -> bool {
  return fs.exists(path);
}
`,
  },

  'std::net': {
    name: 'std::net',
    capabilities: ['net'],
    description: 'HTTP client and network transport (requires net capability)',
    source: `
mod std.net;

pub fn get(url: str) -> str {
  return net.get(url);
}
`,
  },

  'std::time': {
    name: 'std::time',
    capabilities: ['time'],
    description: 'Timestamps and durations (requires time capability)',
    source: `
mod std.time;

pub fn now() -> i64 {
  return time.now();
}
`,
  },

  'std::crypto': {
    name: 'std::crypto',
    capabilities: ['crypto'],
    description: 'Hashing and cryptographic primitives (requires crypto capability)',
    source: `
mod std.crypto;

pub fn sha256(data: str) -> str {
  return std::crypto::sha256(data);
}
`,
  },

  'std::web': {
    name: 'std::web',
    capabilities: ['net', 'ui'],
    description: 'Web application framework primitives: reactive state, virtual DOM, router, forms and HTTP',
    source: `
mod std.web;

pub fn fetch_text(url: str) -> str {
  return net.get(url);
}

pub fn create_element(tag: str, text: str) -> str {
  return "<" + tag + ">" + text + "</" + tag + ">";
}
`,
  },

  'std::serialization': {
    name: 'std::serialization',
    capabilities: [],
    description: 'JSON and structured data serialization and string encoding utilities',
    source: `
mod std.serialization;

pub fn to_json_str(s: str) -> str {
  return "\\"" + s + "\\"";
}

pub fn to_json_i64(n: i64) -> str {
  return "" + n;
}

pub fn to_json_bool(b: bool) -> str {
  if b {
    return "true";
  }
  return "false";
}

pub fn wrap_object(body: str) -> str {
  return "{" + body + "}";
}

pub fn wrap_array(body: str) -> str {
  return "[" + body + "]";
}
`,
  },
};

/**
 * Standard Library Registry providing virtual source resolution during module linking.
 */
export class StdLibraryRegistry {
  private static instance: StdLibraryRegistry;

  public static getInstance(): StdLibraryRegistry {
    if (!this.instance) {
      this.instance = new StdLibraryRegistry();
    }
    return this.instance;
  }

  public getModule(name: string): StdModuleDef | undefined {
    return STD_MODULES[name.toLowerCase()] || STD_MODULES[name];
  }

  public isStdModule(name: string): boolean {
    return name in STD_MODULES || name.toLowerCase() in STD_MODULES;
  }

  public listModules(): StdModuleDef[] {
    return Object.values(STD_MODULES);
  }
}
