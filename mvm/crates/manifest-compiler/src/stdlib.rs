pub struct StdModuleDef {
    pub name: &'static str,
    pub source: &'static str,
}

pub fn lookup_std_module(name: &str) -> Option<&'static StdModuleDef> {
    let lower = name.to_ascii_lowercase();
    STD_MODULES
        .iter()
        .find(|m| m.name == name || m.name == lower.as_str())
}

pub const STD_MODULES: &[StdModuleDef] = &[
    StdModuleDef {
        name: "std::core",
        source: r#"
mod std.core;

pub fn assert(condition: bool, message: str) -> void {
  if !condition {
    console.print("[ASSERTION FAILED] " + message);
  }
}

pub fn identity(x: i64) -> i64 {
  return x;
}
"#,
    },
    StdModuleDef {
        name: "std::result",
        source: r#"
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
"#,
    },
    StdModuleDef {
        name: "std::math",
        source: r#"
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
"#,
    },
    StdModuleDef {
        name: "std::string",
        source: r#"
mod std.string;

pub fn concat(a: str, b: str) -> str {
  return a + b;
}

pub fn is_empty(s: str) -> bool {
  return s == "";
}
"#,
    },
    StdModuleDef {
        name: "std::collections",
        source: r#"
mod std.collections;

pub struct StackItem {
  value: i64
}

pub fn stack_len(items: Array<i64>) -> i64 {
  return items.len();
}
"#,
    },
    StdModuleDef {
        name: "std::io",
        source: r#"
mod std.io;

pub fn println(msg: str) -> void {
  console.print(msg);
}

pub fn print_i64(n: i64) -> void {
  console.print(n);
}
"#,
    },
    StdModuleDef {
        name: "std::fs",
        source: r#"
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
"#,
    },
    StdModuleDef {
        name: "std::net",
        source: r#"
mod std.net;

pub fn get(url: str) -> str {
  return net.get(url);
}
"#,
    },
    StdModuleDef {
        name: "std::time",
        source: r#"
mod std.time;

pub fn now() -> i64 {
  return time.now();
}
"#,
    },
    StdModuleDef {
        name: "std::crypto",
        source: r#"
mod std.crypto;

pub fn sha256(data: str) -> str {
  return std::crypto::sha256(data);
}
"#,
    },
    StdModuleDef {
        name: "std::web",
        source: r#"
mod std.web;

pub fn fetch_text(url: str) -> str {
  return net.get(url);
}

pub fn create_element(tag: str, text: str) -> str {
  return "<" + tag + ">" + text + "</" + tag + ">";
}
"#,
    },
    StdModuleDef {
        name: "std::serialization",
        source: r#"
mod std.serialization;

pub fn to_json_str(s: str) -> str {
  return "\"" + s + "\"";
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
"#,
    },
];
