# Manifest Core v0.1 & Compiler Architecture

> **Manifest**: A human-readable, general-purpose programming language designed for clarity, safety, and beginners.

This repository contains the official reference implementation of **Manifest Core v0.1** and the foundational **Manifest Compiler Architecture**.

---

## 1. What is Manifest?

Manifest is designed from first principles as an intuitive, structured programming language that reads like plain instructions. It avoids esoteric punctuation (`{`, `}`, `;`, `&&`, `||`) while maintaining strict semantic correctness, modularity, and security.

### Core Philosophy:
- **Human-Readable:** `SET balance TO 100` instead of `balance = 100;`.
- **Friendly Diagnostics:** Beginner-oriented error messages that show exactly what was expected, what was found, and how to fix it.
- **Safety First:** Pure interpreter with sandboxed scope; zero `eval()`, zero arbitrary JavaScript escapes.
- **Decoupled Compiler Pipeline:** Source -> Lexer -> Parser -> AST -> Semantic Analysis / Validation -> Manifest IR -> Target Compiler -> Generated Artifacts.

---

## 2. Complete Compiler & Runtime Pipeline

Manifest provides two execution paths: direct interpreted execution (for rapid feedback and development) and multi-target compilation (for production deployment and execution on target platforms).

```
                      Manifest Source (.manifest)
                                  │
                                  ▼
                        [ 1. Lexer / Tokenizer ]
                                  │
                                  ▼
                             [ 2. Parser ]
                                  │
                                  ▼
                         [ 3. Abstract Syntax Tree ]
                                  │
                                  ▼
                   [ 4. Semantic Validator / Analyzer ]
                                  │
               ┌──────────────────┴──────────────────┐
               │                                     │
               ▼                                     ▼
      [ Direct Interpreter ]              [ 5. Manifest IR Builder ]
               │                                     │
               ▼                                     ▼
        Runtime & Events                    [ Target-Agnostic IR ]
               │                                     │
               ▼                                     ▼
       Manifest Console                   [ 6. Target Compiler ]
                                            ├── JavaScript / Web (Active)
                                            ├── TypeScript (Pluggable)
                                            ├── WebAssembly (Future)
                                            ├── Rust (Future)
                                            └── Solana Target (Future)
                                                     │
                                                     ▼
                                            [ Generated Artifacts ]
```

### Simple Explanation of the Phases:

1. **Lexer (`manifest-core/src/lexer/`):**
   Reads characters one by one. Groups characters into typed tokens like `KEYWORD(SET)`, `IDENTIFIER(balance)`, `KEYWORD(TO)`, and `NUMBER(100)`.

2. **Parser (`manifest-core/src/parser/`):**
   Understands the grammar of Manifest sentences and assembles tokens into an AST.

3. **AST (`manifest-core/src/ast/`):**
   Structured, syntax-level tree reflecting program syntax.

4. **Validator (`manifest-core/src/validator/`):**
   Static semantic analyzer verifying scopes, action parameter counts, and detecting semantic issues prior to execution or IR generation.

5. **Manifest IR (`manifest-core/src/ir/`):**
   Clean, target-agnostic intermediate representation. Encapsulates pure language semantics (variables, assignments, branches, loops, actions, calls, events) independent of any specific runtime (Node, browser, WebAssembly, Rust).

6. **Target Compiler (`manifest-core/src/compiler/`):**
   Pluggable backend compilers that consume Manifest IR and emit target source code and artifacts:
   - **`JavaScriptTargetCompiler` (`targetName: 'js'`):** Emits modern JavaScript with a lightweight runtime shim, callable actions, event dispatchers, and exported lifecycle handlers (`startApp()`).
   - Clean abstractions allow future backends (`wasm`, `rust`, `solana`) to be implemented without modifying core parser or validation logic.

---

## 3. CLI Commands

The Manifest CLI provides a comprehensive interface for checking, running, and compiling programs:

```bash
# 1. Run a program directly in the interpreter:
npx tsx manifest-core/src/cli.ts run manifest-core/examples/hello.manifest
# (or simply)
npx tsx manifest-core/src/cli.ts manifest-core/examples/hello.manifest

# 2. Check syntax and semantic validity without running:
npx tsx manifest-core/src/cli.ts check manifest-core/examples/counter.manifest

# 3. View the generated Manifest IR:
npx tsx manifest-core/src/cli.ts ir manifest-core/examples/hello.manifest

# 4. Compile to target code (defaults to JavaScript):
npx tsx manifest-core/src/cli.ts build manifest-core/examples/hello.manifest js

# 5. List all supported compilation targets:
npx tsx manifest-core/src/cli.ts targets
```

---

## 4. Manifest Core Syntax Reference

### 1. App Identification
```manifest
APP "MyApplication"
```

### 2. Variable State & Arithmetic
```manifest
SET count TO 0
SET count TO count + 1
```

### 3. Output
```manifest
SHOW "Hello World"
SHOW count
```

### 4. Branching Logic (IF / ELSE / ELSE IF)
```manifest
IF balance >= 10
    SHOW "You can pay"
ELSE IF balance == 5
    SHOW "Halfway there"
ELSE
    SHOW "Insufficient balance"
END
```

### 5. Event Handling
```manifest
WHEN app.starts
    SHOW "System initialized"
END
```

### 6. Loops
```manifest
REPEAT 5 TIMES
    SHOW "Repeating..."
END

SET items TO ["Apples", "Oranges", "Bananas"]
FOR EACH fruit IN items
    SHOW fruit
END
```

### 7. Actions & Returns
```manifest
ACTION addNumbers with a, b
    RETURN a + b
END

SET sum TO CALL addNumbers 10 20
SHOW sum
```

### 8. Try / Catch Safety
```manifest
TRY
    SET result TO 10 / 0
IF FAILED
    SHOW "Handled safely."
END
```

---

## 5. Manifest Studio IDE

Manifest Studio is a web-based integrated development environment for writing, testing, compiling, and running Manifest applications:

- **Desktop 3-Panel Workspace:**
  - **Left Panel:** Project & File Explorer (`manifest.toml`, `src/main.manifest`, `build/` artifacts).
  - **Center Panel:** Manifest Code Editor with syntax highlighting, line numbers, automatic block indentation, keyboard shortcuts, inline diagnostic markers, and keyword autocomplete.
  - **Right Panel:** Sandboxed, isolated Application Preview executing compiled JavaScript code with reactive state visualization and interactive action triggers.
  - **Bottom Panel:** Tabbed Console output and structured Problems/diagnostics reporting.
- **Mobile Responsive Design:** Dedicated tab bar (`Files`, `Editor`, `Preview`, `Console`, `Problems`) optimized for touch and mobile viewports.
- **Reference Testbench:** Seamlessly switch between Manifest Studio IDE and the low-level Reference Testbench & Runtime Inspector.

---

## 6. Automated Test Suite

Run the full automated test suite (including core runtime tests and compiler/IR tests):

```bash
npm run manifest:test
# or
npx tsx manifest-core/tests/run_tests.ts
```
