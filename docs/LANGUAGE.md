# The Manifest Programming Language — Overview & Guide

> **Manifest** is a high-level, general-purpose programming language designed around readable syntax, explicit capabilities, verifiable effects, portable execution, and multiple compilation targets.

For the normative 26-section language specification and formal EBNF grammars, see [`LANGUAGE_SPEC.md`](./LANGUAGE_SPEC.md).

---

## 1. Why Manifest Exists

Most languages force an artificial choice:
- Beginner-friendly scripting languages omit static types, allow unrestricted ambient I/O (`fs`, `net`, `env`), and lack portable binary execution.
- Systems and contract languages enforce strict types and safety, but impose steep syntactic overhead and lock programs to a single runtime.

Manifest resolves this tension through three architectural principles:
1. **Two Syntax Profiles, One Semantic Language**: Beginners write structured keyword blocks (`Beginner Profile`); experienced developers write concise brace-and-type syntax (`Professional Profile`). Both parse into the **identical `SemanticModule` AST**, undergo the same static type and capability verification, lower to the same Typed Manifest IR (`MIRModule`), and emit identical `.mbc` bytecode.
2. **Zero Ambient Authority (Capabilities & Verifiable Effects)**: No module or function can perform console output, file access, network requests, clock reads, database queries, or cryptographic operations unless permitted by module capability declarations (`requires`, `denies`) and verified across the transitive call graph (`effects(...)`).
3. **Target Independence**: Manifest's semantics are defined by its own type system, Typed IR, `.mbc` v1.0 bytecode specification, and memory-safe Rust Virtual Machine (`mvm`), while also compiling to capability-restricted Web JavaScript, standalone W3C WebAssembly (`.wasm`), standalone safe Rust for native binaries, and Solana Anchor programs.

---

## 2. Side-by-Side: Beginner Profile vs Professional Profile

Every general-purpose construct in Manifest has a 1-to-1 structural correspondence between the two profiles:

| Construct | Beginner Profile | Professional Profile | Canonical Type / AST |
|---|---|---|---|
| Module Header | `MODULE billing` | `module billing;` | `SemanticModule.moduleName` |
| Capabilities | `REQUIRES console, crypto` / `DENIES net` | `requires [console, crypto];` / `denies [net];` | `CapabilitySummaryDecl` |
| Imports | `IMPORT compute_tax FROM "./tax"` | `import { compute_tax } from "./tax";` | `ImportDecl` |
| Immutable Binding | `LET subtotal: Int = 250` | `let subtotal: i64 = 250;` | `VarDecl (mutable: false)` |
| Mutable Binding | `MUTABLE count: Int = 0` (or `LET MUTABLE`) | `let mut count: i64 = 0;` | `VarDecl (mutable: true)` |
| Assignment | `SET count TO count + 1` | `count = count + 1;` | `AssignStmt` |
| Constant | `CONSTANT LIMIT: Int = 1000` | `const LIMIT: i64 = 1000;` | `ConstDecl` |
| Primitives | `Int`, `Float`, `Bool`, `Text`, `Void` | `i64`, `f64`, `bool`, `str`, `void` | `i64`, `f64`, `bool`, `str`, `void` |
| Collections | `List<Int>`, `Map<Text, Int>` | `Array<i64>`, `Map<str, i64>` | `Array<T>`, `Map<K, V>` |
| Struct | `STRUCT Order ... END` + `NEW Order(...)` | `struct Order { ... }` + `Order { ... }` | `StructDecl` / `StructLiteral` |
| Enum | `ENUM Status ... END` | `enum Status { ... }` | `EnumDecl` |
| Function | `FUNCTION calc(x: Int) -> Int EFFECTS console ... END` | `fn calc(x: i64) -> i64 effects(console) { ... }` | `FnDecl` |
| Pattern Match | `MATCH s WHEN Status::Ok(v) ... ELSE ... END` | `match s { Status::Ok(v) => { ... }, _ => { ... } }` | `MatchStmt` |
| Loops | `WHILE ... END`, `FOR EACH x IN xs ... END`, `REPEAT n TIMES ... END` | `while cond { ... }`, `for x in xs { ... }`, `repeat (n) { ... }` | `WhileStmt`, `ForInStmt`, `RepeatStmt` |

---

## 3. Identical Program in Both Profiles

### 3.1 Beginner Profile (`examples/beginner/02_inventory_records.manifest`)
```manifest
MODULE inventory_demo

REQUIRES console
DENIES net

STRUCT Item
    sku: Text
    qty: Int
    unit_price: Int
END

ENUM ReorderDecision
    Sufficient(Int)
    RestockNeeded(Int)
END

FUNCTION evaluate_stock(item: Item, minimum: Int) -> ReorderDecision
    IF item.qty < minimum
        RETURN ReorderDecision::RestockNeeded(minimum - item.qty)
    ELSE
        RETURN ReorderDecision::Sufficient(item.qty * item.unit_price)
    END
END

FUNCTION main() -> Int EFFECTS console
    LET sensor = NEW Item(sku: "HX-400", qty: 14, unit_price: 25)
    LET decision = evaluate_stock(sensor, 10)

    MATCH decision
        WHEN ReorderDecision::Sufficient(total_value)
            SHOW "Stock value: " + to_str(total_value)
            RETURN total_value
        WHEN ReorderDecision::RestockNeeded(missing)
            SHOW "Need units: " + to_str(missing)
            RETURN missing
    END
END
```

### 3.2 Equivalent Professional Profile
```manifest
module inventory_demo;

requires [console];
denies [net];

struct Item {
    sku: str,
    qty: i64,
    unit_price: i64,
}

enum ReorderDecision {
    Sufficient(i64),
    RestockNeeded(i64),
}

fn evaluate_stock(item: Item, minimum: i64) -> ReorderDecision {
    if item.qty < minimum {
        return ReorderDecision::RestockNeeded(minimum - item.qty);
    } else {
        return ReorderDecision::Sufficient(item.qty * item.unit_price);
    }
}

fn main() -> i64 effects(console) {
    let sensor = Item { sku: "HX-400", qty: 14, unit_price: 25 };
    let decision = evaluate_stock(sensor, 10);

    match decision {
        ReorderDecision::Sufficient(total_value) => {
            print("Stock value: " + to_str(total_value));
            return total_value;
        },
        ReorderDecision::RestockNeeded(missing) => {
            print("Need units: " + to_str(missing));
            return missing;
        },
    }
}
```

Both programs compile to the same Typed IR, emit equivalent `.mbc` v1.0 bytecode, pass static verification in `mvm-core`, print `"Stock value: 350"`, and return `350` (`i64`).

---

## 4. Related Specifications

- **Formal Language Specification**: [`LANGUAGE_SPEC.md`](./LANGUAGE_SPEC.md)
- **Standard Library Reference**: [`STANDARD_LIBRARY.md`](./STANDARD_LIBRARY.md)
- **Capability & Security Model**: [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)
- **Binary Bytecode Format (`.mbc`)**: [`BYTECODE_SPEC.md`](./BYTECODE_SPEC.md)
- **Rust Virtual Machine (`mvm`)**: [`VM_SPEC.md`](./VM_SPEC.md)
- **Compiler Targets**: [`COMPILER_TARGETS.md`](./COMPILER_TARGETS.md)
