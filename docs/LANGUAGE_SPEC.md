# Manifest Programming Language Specification — Version 1.0

**Status:** Authoritative Normative Specification (v1.0)  
**Implementation Reference:** `manifest-core/src/` (Frontend, TypeChecker, Capability Analyzer, Typed MIR, `.mbc` Emitter) & `mvm/crates/mvm-core/` (Rust Virtual Machine)

> *Historical v0.2 UI prototype notes are archived in [`archive/MANIFEST_v0.2_SPEC.md`](./archive/MANIFEST_v0.2_SPEC.md).*

---

## 1. Language Philosophy & Identity

Manifest is a high-level, general-purpose programming language designed around readable syntax, explicit capabilities, verifiable effects, portable execution, and multiple compilation targets.

1. **General-Purpose Semantics**: Manifest's core semantics are target-independent and cover general software engineering, backend/API logic, CLI/automation, data pipelines, desktop/game logic, systems foundations, web applications, and smart contracts.
2. **No Ambient Authority**: Pure computation requires zero capabilities. Side-effecting operations (`console`, `fs.read`, `fs.write`, `net`, `db`, `time`, `crypto`) require explicit module and function declarations verified statically and enforced at runtime.
3. **Checked Deterministic Semantics**: 64-bit integer arithmetic (`i64`) is two's-complement overflow-checked (`i64::MIN ..= i64::MAX`); division or modulo by zero traps deterministically across all targets.

---

## 2. Dual Syntax Profiles (`Beginner` & `Professional`)

Manifest defines **two concrete surface syntaxes** that parse into a **single canonical AST (`SemanticModule` in `manifest-core/src/core/ast-v2.ts`)**:

1. **Beginner Profile (`beginner`)**: Keyword-delimited blocks (`MODULE`, `REQUIRES`, `DENIES`, `IMPORT ... FROM`, `LET`, `MUTABLE`, `SET ... TO`, `CONSTANT`, `STRUCT ... END`, `ENUM ... END`, `FUNCTION ... END`, `IF ... ELSE ... END`, `MATCH ... WHEN ... END`, `SHOW`).
2. **Professional Profile (`professional`)**: Brace-and-semicolon syntax (`module`, `requires [...]`, `denies [...]`, `import { ... } from "..."`, `let`, `let mut`, `const`, `struct { ... }`, `enum { ... }`, `fn ... { ... }`, `if / else`, `match { ... }`).

### 2.1 Profile Detection & Coexistence Rules
1. Explicit compiler/IDE option (`--profile beginner` or `--profile professional`) takes highest precedence.
2. File-header pragma (`PROFILE beginner` or `profile professional;`) within the first 10 non-comment lines takes second precedence.
3. Otherwise, `detectSyntaxProfile()` (`manifest-core/src/core/profile.ts`) inspects unambiguous top-level tokens (`module <name>;`, `fn`, `let`, `const`, `struct {`, `enum {` -> `professional`; `APP`, `PAGE`, `PROGRAM`, `MODULE`, `FUNCTION` -> `beginner`).
4. Modules written in Beginner Profile and Professional Profile can freely `import` and `export` functions, structs, enums, and constants across files in the same workspace.
5. `formatManifestSource(source, targetProfile)` losslessly translates general-purpose modules between `beginner` and `professional`.

---

## 3. Lexical Structure

- **Encoding**: UTF-8 source text; `\r\n` is normalized to `\n`.
- **Comments**:
  - Professional & Beginner: `// line comment`, `/* block comment */`.
  - Beginner additional aliases: `-- line comment`, `# line comment` (outside hex color literals in legacy UI blocks), `NOTE: line comment`.
- **Identifiers**: `[A-Za-z_][A-Za-z0-9_]*`. Qualified intrinsic paths use `::` (`std::crypto::sha256`, `Settlement::Cleared`) or dotted host namespaces (`console.print`, `fs.read_text`).
- **Literals**:
  - Integer (`i64`): Decimal digits with optional `_` separators (`42`, `1_000_000`). Checked against signed 64-bit bounds.
  - Float (`f64`): Decimal digits with fractional part (`3.14159`, `0.5`).
  - Boolean (`bool`): `true` / `false` (Professional) and `TRUE` / `FALSE` (Beginner).
  - String (`str`): Double-quoted UTF-8 strings (`"hello\nworld"`) supporting `\n`, `\r`, `\t`, `\"`, `\\`.

---

## 4. Source Files, Modules & Visibility

- **File Extension**: `.manifest` (source), `.mbc` (compiled Manifest Bytecode).
- **Module Header**: Optional `module <name>;` (Professional) or `MODULE <name>` (Beginner). Defaults to `main` when omitted.
- **Imports**:
  - Professional: `import { sym1, sym2 as alias } from "./other_module";`
  - Beginner: `IMPORT sym1, sym2 AS alias FROM "./other_module"`
- **Visibility**: Declarations are module-private by default. Prefixing `export` / `EXPORT` on `fn`/`FUNCTION`, `struct`/`STRUCT`, `enum`/`ENUM`, `trait`/`TRAIT`, or `const`/`CONSTANT` exposes the symbol to importing modules.
- **Module Graph Resolution (`module-resolver.ts`)**: Resolves relative paths (`.manifest` optional), verifies that every imported symbol exists and is marked `export`, rejects circular module dependencies (`E_CIRCULAR_IMPORT`), and merges verified definitions in topological dependency order.

---

## 5. Top-Level Declarations

A `SemanticModule` contains:
1. Capability summary (`requires`, `provides`, `denies`)
2. Module imports (`import` / `IMPORT`)
3. Struct definitions (`struct` / `STRUCT`)
4. Algebraic enum definitions (`enum` / `ENUM`)
5. Trait interface declarations (`trait` / `TRAIT`)
6. Compile-time constants (`const` / `CONSTANT`)
7. Global bindings (`let` / `LET`, `let mut` / `MUTABLE`)
8. Function declarations (`fn` / `FUNCTION`)
9. Optional top-level script statements (compiled into synthetic `__top_level` / `main` entry if no explicit `fn main()` is declared).

---

## 6. Static Type System

Both profiles normalize type names via `normalizePrimitiveTypeName()`:

| Canonical Type | Professional Syntax | Beginner Syntax | Representation |
|---|---|---|---|
| `i64` | `i64` | `Int` (or `Integer`) | Signed 64-bit two's-complement integer |
| `f64` | `f64` | `Float` (or `Number`) | IEEE-754 64-bit floating-point |
| `bool` | `bool` | `Bool` (or `Boolean`) | Logical boolean (`true` / `false`) |
| `str` | `str` | `Text` (or `String`) | Immutable UTF-8 string |
| `void` | `void` | `Void` (or `Unit`) | Unit type for functions with no return value |
| `Array<T>` | `Array<T>` | `List<T>` / `Array<T>` | Homogeneous dynamic sequence |
| `Map<K, V>` | `Map<K, V>` | `Map<K, V>` | Ordered key-value dictionary |
| `Result<T, E>` | `Result<T, E>` | `Result<T, E>` | Recoverable outcome (`Result::Ok(T)` \| `Result::Err(E)`) |
| `Struct` | `StructName<T>` | `StructName<T>` | Nominal product record |
| `Enum` | `EnumName<T>` | `EnumName<T>` | Nominal tagged union (sum type) |

Implicit coercions between `i64`, `f64`, `bool`, and `str` are **forbidden** (`E_TYPE_MISMATCH` / `E_BINOP_TYPE`). Explicit conversions use `std::conv::to_f64`, `std::conv::to_i64`, and `std::conv::to_str`.

---

## 7. Type Inference

- Local and global variable bindings (`let x = 42;` / `LET x = 42`) infer their static type from their initializer expression when the `: Type` annotation is omitted.
- Array literals (`[1, 2, 3]`) infer `Array<i64>` from element types and check homogeneity across elements.
- Generic function calls (`identity(42)`) unify type parameters (`T -> i64`) from call arguments (`substituteTypeParams`).
- Function parameter types default to `any` only in legacy untyped `ACTION` blocks; v1.0 functions annotate parameter and non-`void` return types explicitly.

---

## 8. Mutability Model

- **Immutable by Default**: `let x = 10;` / `LET x = 10` creates an immutable binding. Reassigning `x` produces compile-time error `E_IMMUTABLE_ASSIGN`.
- **Explicit Mutability**: `let mut x = 10;` / `MUTABLE x = 10` (or `LET MUTABLE x = 10`) permits reassignment (`x = 20;` / `SET x TO 20`), field mutation (`item.qty = 5`), and index mutation (`arr[0] = 9`).
- **Constants**: `const MAX: i64 = 100;` / `CONSTANT MAX: Int = 100` is permanently immutable (`E_CONST_ASSIGN`).

---

## 9. Values, References, Ownership & Memory Model

- **Primitives (`i64`, `f64`, `bool`, `void`) and Strings (`str`)**: Value semantics. Strings are immutable UTF-8 byte sequences; concatenation allocates a new string.
- **Composite Values (`Array`, `Map`, `Struct`, `Enum`)**: Allocated in a deterministic, bounds-checked arena heap (`HeapId` in `mvm-core`, managed references in WASM/JS, owned `Vec`/`BTreeMap`/structs in Native Rust). No raw pointers, pointer arithmetic, or `unsafe` memory operations exist in Manifest.

---

## 10. Expressions & Operator Precedence

From lowest to highest precedence:
1. Logical OR: `||` / `OR` (short-circuiting, requires `bool` operands)
2. Logical AND: `&&` / `AND` (short-circuiting, requires `bool` operands)
3. Equality: `==`, `!=` (operands must have compatible types -> `bool`)
4. Relational: `<`, `<=`, `>`, `>=` (`i64`, `f64`, or `str` -> `bool`)
5. Additive: `+` (`i64 + i64`, `f64 + f64`, or `str + str` concatenation), `-` (`i64`, `f64`)
6. Multiplicative: `*`, `/` (`i64`, `f64`), `%` (`i64`)
7. Unary prefix: `-` (numeric negation), `!` / `NOT` (`bool` negation), `await` / `AWAIT`
8. Postfix: Function call `f(a, b)`, field access `obj.field`, index access `arr[i]`, error propagation `expr?`
9. Primary: Literals, identifiers, parenthesized `(expr)`, array `[...]`, map `{k: v}`, struct literal `Point { x: 1, y: 2 }` / `NEW Point(x: 1, y: 2)`, enum constructor `Opt::Some(1)`.

---

## 11. Statements & Control Flow

- **Bindings & Assignment**: `VarStmt`, `ConstStmt`, `AssignStmt`.
- **Conditionals**: `if cond { ... } else { ... }` / `IF cond ... ELSE ... END`. `cond` **must** have static type `bool` (`E_COND_NOT_BOOL` — truthiness of integers or strings is rejected).
- **Loops**:
  - `while cond { ... }` / `WHILE cond ... END` (`cond: bool`)
  - `for item in array_expr { ... }` / `FOR EACH item IN array_expr ... END`
  - `repeat (count_expr) { ... }` / `REPEAT count_expr TIMES ... END` (`count_expr: i64`)
  - Loop control: `break;` / `BREAK` and `continue;` / `CONTINUE` (valid only inside a loop; rejected outside loops with `E_LOOP_CONTROL`).
- **Return**: `return expr;` / `RETURN expr` (checked against enclosing function's declared return type `E_RETURN_TYPE`).

---

## 12. Functions & Recursion

- **Declaration**:
  - Professional: `[export] [async] fn name<T>(p1: T1, p2: T2) -> Ret [effects(e1, e2)] { ... }`
  - Beginner: `[EXPORT] [ASYNC] FUNCTION name<T>(p1: T1, p2: T2) [-> Ret | RETURNS Ret] [EFFECTS e1, e2] ... END`
- **Entry Point**: If `fn main()` is present, execution invokes `main` and captures its return value (`i64`, `bool`, `str`, `void`, etc.). Otherwise top-level statements execute in declaration order.
- **Recursion**: Direct and mutual recursion are supported across all targets, bounded by deterministic call-frame depth limits (`max_call_depth = 256` by default in Rust MVM).

---

## 13. Structs / Records

Nominal product types with named, typed fields and optional generic type parameters:
```manifest
struct Vector2<T> {
    x: T,
    y: T,
}
```
Struct construction checks that every declared field is initialized with a value of the declared type (`E_MISSING_FIELD`, `E_UNKNOWN_FIELD`, `E_FIELD_TYPE`) and lowers field accesses (`v.x`) to statically resolved zero-based field indices (`FIELD_GET u16`, `FIELD_SET u16`).

---

## 14. Algebraic Enums / Tagged Unions

Nominal sum types whose variants carry zero or more positional typed payloads:
```manifest
enum PaymentState {
    Pending,
    Authorized(i64),
    Declined(str),
}
```
Each variant compiles to a compact integer tag (`0..N-1`) plus payload tuple (`ENUM_NEW`, `ENUM_TAG`, `ENUM_PAYLOAD`).

---

## 15. Pattern Matching & Exhaustiveness

`match` / `MATCH` dispatches on `enum`, `Result<T, E>`, `i64`, `bool`, or `str` subjects:
- **Patterns**:
  - Enum variant destructuring: `EnumName::Variant(b1, b2)` (binds payload variables `b1`, `b2` in arm scope with their exact variant payload types)
  - Literal pattern: `0`, `true`, `"ok"`
  - Wildcard pattern: `_` (Professional) or `ELSE` / `WHEN _` (Beginner)
- **Exhaustiveness Verification**: When matching an `enum` or `Result<T, E>` without a wildcard arm, `TypeChecker` verifies that **every** variant of the enum is covered; missing variants fail compilation with `E_NON_EXHAUSTIVE_MATCH` naming the unhandled variants.

---

## 16. Traits / Interfaces

`trait` / `TRAIT` declarations specify named behavioral contracts with typed method signatures and effect bounds:
```manifest
trait Hashable {
    fn digest(self_val: str) -> str effects(crypto);
}
```
Trait declarations are parsed into `TraitDecl` nodes in `SemanticModule` and validated for type well-formedness. Dynamic trait-object vtables (`dyn Trait`) are reserved for a future minor version.

---

## 17. Generics

Functions, structs, and enums accept type parameters `<T, U>`:
```manifest
fn first_or<T>(items: Array<T>, fallback: T) -> T {
    if std::str::len(items) > 0 {
        return items[0];
    }
    return fallback;
}
```
`TypeChecker` unifies generic type arguments at call sites and struct/enum instantiations, rejecting conflicting bindings (`E_GENERIC_CONFLICT`).

---

## 18. Error Handling (`Result<T, E>`, `?`, and Traps)

Manifest separates **recoverable domain errors** from **unrecoverable invariant traps**:
1. **Recoverable Errors (`Result<T, E>`)**: Built-in algebraic sum type with `Result::Ok(val)` and `Result::Err(err)`.
2. **Propagation Operator (`expr?`)**: Evaluates `expr` of type `Result<T, E>`. If `Result::Ok(v)`, yields `v: T`; if `Result::Err(e)`, immediately returns `Result::Err(e)` from the enclosing function (verified to return `Result<_, E>`, otherwise `E_TRY_PROPAGATE_TYPE`).
3. **Deterministic Traps**: Integer overflow/underflow, division/modulo by zero, out-of-bounds array index, capability violation, or step-budget exhaustion immediately abort VM execution with a structured `VmTrap` diagnostic rather than silently corrupting state. (Legacy `TRY ... IF FAILED` remains supported in the AST interpreter and Web/JS runtime for v0.2 compatibility.)

---

## 19. Async & Concurrency Model

Functions may be annotated `async fn` / `ASYNC FUNCTION` and expressions may use `await expr` / `AWAIT expr`. In Manifest v1.0:
- On the **JavaScript / Web** target, async functions lower cleanly to native Promises.
- On the **Rust MVM** target, execution is single-threaded and deterministic; host calls execute synchronously through the host capability dispatcher so replay determinism is preserved. Multi-threaded shared-memory concurrency is intentionally excluded from v1.0.

---

## 20. Capability & Verifiable Effect System

Every host-interacting operation belongs to a named capability domain:
- `console` — Standard output (`print`, `println`, `SHOW`, `console.print`, `std::io::println`)
- `fs.read` — Workspace/host file reads (`fs.read_text`, `std::fs::read_text`)
- `fs.write` — Workspace/host file writes (`fs.write_text`, `std::fs::write_text`)
- `net` — Outbound HTTP/network requests (`net.get`, `std::net::get`, `fetch`)
- `db` — Key-value / query storage (`db.query`, `std::db::query`)
- `time` — Wall-clock timestamps (`time.now`, `std::time::now`)
- `crypto` — Cryptographic hashing (`crypto.hash`, `std::crypto::sha256`)

### 20.1 Static Verification Rules (`capability-analyzer.ts`)
1. **Contradiction Check (`E_CAP_CONFLICT`)**: A capability cannot appear in both `requires` and `denies`.
2. **Transitive Call-Graph Closure**: Direct intrinsic effects of each function are propagated across the call graph until a fixed point is reached (`inferredEffects`).
3. **Explicit Denial (`E_CAP_DENIED`)**: If a module declares `denies [net]`, any direct or transitive `net` effect anywhere in the module fails compilation.
4. **Module Capability Boundary (`E_CAP_UNDECLARED`)**: Privileged effects (`fs.read`, `fs.write`, `net`, `db`, `time`, `crypto`)—and any effect when `requires [...]` is present—must be covered by `requires` (prefix-aware: `requires [fs]` covers `fs.read` and `fs.write`).
5. **Function Effect Contract (`E_EFFECT_VIOLATION`)**: If a function declares `effects(console)` (or `effects(pure)`), any inferred direct or transitive effect outside that list fails compilation.

---

## 21. Determinism & Resource Bounds

Programs with no `time`, `net`, `fs.*`, or `db` capabilities are **strictly deterministic**: identical inputs produce bit-identical outputs and step counts across the TypeScript MIR evaluator and the Rust MVM (`mvm-cli` and `mvm-wasm`). Execution is bounded by configurable `max_steps` (default `1,000,000`), `max_stack` (statically verified per function), `max_call_depth` (`256`), and `max_heap_objects` (`65,536`).

---

## 22. Standard Library Namespaces

Core standard library intrinsics live under `std::math`, `std::str`, `std::conv`, `std::io`, `std::time`, `std::fs`, `std::net`, `std::db`, and `std::crypto`. Full signatures and capability requirements are specified in [`STANDARD_LIBRARY.md`](./STANDARD_LIBRARY.md).

---

## 23. Foreign Function Interface (FFI) & Host Bindings

External host operations are represented explicitly in `.mbc` bytecode via the `IMPORT_TABLE` section (`symbol`, `capability`, `arity`, `hasReturn`) and invoked exclusively via `HOST_CALL <import_idx>`. Arbitrary unverified FFI pointers are prohibited.

---

## 24. Domain Profiles (Web, Backend, Systems, Smart Contracts)

- **General-Purpose / Backend / CLI / Data**: Standard `module` / `MODULE` compiled to `.mbc` (Rust MVM), `.wasm`, Native Rust, or Web JS.
- **Declarative Web UI Extension (`APP` / `PAGE`)**: Beginner-profile reactive UI DSL preserved for browser applications (`web-js` target).
- **Solana Smart-Contract Extension (`PROGRAM` / `ACCOUNT` / `INSTRUCTION`)**: Compiles to Anchor Rust (`lib.rs`) + IDL JSON (`idl.json`) with local account/invariant simulation (`solana-sbf` target).

---

## 25. Versioning & Compatibility Policy

- **Language & Bytecode Version**: `1.0` (`.mbc` header `major = 1, minor = 0`).
- **Backward Compatibility**: Existing v0.1–v0.4 `.manifest` programs (`APP`, `PAGE`, `ACTION`, `PROGRAM`) continue to parse, validate, compile, and pass all regression tests unchanged.

---

## 26. Formal EBNF Grammar Summary

### 26.1 Professional Profile EBNF
```ebnf
Module         ::= ("profile" "professional" ";")? ("module" DottedIdent ";")? TopItem*
TopItem        ::= CapDecl | ImportDecl | ExportedDecl | Stmt
CapDecl        ::= ("requires" | "provides" | "denies") ("[" CapList "]" | CapList) ";"?
ImportDecl     ::= "import" "{" ImportSpec ("," ImportSpec)* "}" "from" StringLit ";"?
ExportedDecl   ::= "export"? (StructDecl | EnumDecl | TraitDecl | ConstDecl | FnDecl | VarDecl)
StructDecl     ::= "struct" Ident TypeParams? "{" (Ident ":" Type ","?)* "}"
EnumDecl       ::= "enum" Ident TypeParams? "{" (Ident ("(" TypeList ")")? ","?)* "}"
TraitDecl      ::= "trait" Ident TypeParams? "{" ("fn" Ident "(" ParamList ")" ("->" Type)? Effects? ";")* "}"
FnDecl         ::= "async"? "fn" Ident TypeParams? "(" ParamList ")" ("->" Type)? Effects? Block
Effects        ::= "effects" "(" IdentList ")"
Block          ::= "{" Stmt* "}"
Stmt           ::= VarDecl | ConstDecl | AssignStmt | IfStmt | WhileStmt | ForStmt | RepeatStmt
                 | MatchStmt | TryStmt | ReturnStmt | "break" ";" | "continue" ";" | Expr ";"
VarDecl        ::= "let" "mut"? Ident (":" Type)? "=" Expr ";"
ConstDecl      ::= "const" Ident (":" Type)? "=" Expr ";"
IfStmt         ::= "if" Expr Block ("else" (IfStmt | Block))?
WhileStmt      ::= "while" Expr Block
ForStmt        ::= "for" Ident "in" Expr Block
RepeatStmt     ::= "repeat" "(" Expr ")" Block
MatchStmt      ::= "match" Expr "{" (Pattern "=>" (Block | Stmt) ","?)* "}"
Pattern        ::= "_" | Literal | (Ident "::")? Ident ("(" IdentList ")")?
```

### 26.2 Beginner Profile EBNF
```ebnf
Module         ::= ("PROFILE" "beginner")? ("MODULE" DottedIdent)? TopItem*
TopItem        ::= CapDecl | ImportDecl | ExportedDecl | Stmt
CapDecl        ::= ("REQUIRES" | "PROVIDES" | "DENIES") CapList Newline
ImportDecl     ::= "IMPORT" ImportSpec ("," ImportSpec)* "FROM" StringLit Newline
ExportedDecl   ::= "EXPORT"? (StructDecl | EnumDecl | TraitDecl | ConstDecl | FnDecl | VarDecl)
StructDecl     ::= "STRUCT" Ident TypeParams? Newline (Ident ":" Type Newline)* "END"
EnumDecl       ::= "ENUM" Ident TypeParams? Newline (Ident ("(" TypeList ")")? Newline)* "END"
FnDecl         ::= "ASYNC"? "FUNCTION" Ident TypeParams? "(" ParamList ")" (("->" | "RETURNS") Type)?
                   ("EFFECTS" IdentList)? Newline Stmt* "END"
Stmt           ::= VarDecl | ConstDecl | SetStmt | ShowStmt | IfStmt | WhileStmt | ForEachStmt
                 | RepeatStmt | MatchStmt | ReturnStmt | "BREAK" | "CONTINUE" | Expr
VarDecl        ::= ("LET" "MUTABLE"? | "MUTABLE") Ident (":" Type)? ("=" | "TO") Expr
ConstDecl      ::= "CONSTANT" Ident (":" Type)? ("=" | "TO") Expr
SetStmt        ::= "SET" AssignTarget ("=" | "TO") Expr
ShowStmt       ::= "SHOW" Expr
IfStmt         ::= "IF" Expr Newline Stmt* ("ELSE" Newline Stmt*)? "END"
WhileStmt      ::= "WHILE" Expr Newline Stmt* "END"
ForEachStmt    ::= "FOR" "EACH"? Ident "IN" Expr Newline Stmt* "END"
RepeatStmt     ::= "REPEAT" Expr "TIMES"? Newline Stmt* "END"
MatchStmt      ::= "MATCH" Expr Newline (("WHEN" Pattern | "ELSE") Newline Stmt*)+ "END"
```
