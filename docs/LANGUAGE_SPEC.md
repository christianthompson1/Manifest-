# Manifest Language Specification

**Version:** 0.4.0  
**Status:** Canonical Reference

---

## 1. Design Philosophy

Manifest is a human-readable, general-purpose declarative and imperative programming language. It is designed to be:
1. **Clear and expressive**: Reads like structured natural language without cryptic punctuation symbols.
2. **Deterministic and safe**: Strong semantic validation preventing undefined variables, missing block terminations, and runtime unhandled exceptions.
3. **Multi-Target**: Compiles cleanly to modern browser JavaScript (DOM-based reactive single-page applications) and Anchor Rust (Solana on-chain programs), while also supporting direct headless AST interpretation in CLI and test environments.

---

## 2. Lexical Grammar & Tokens

### Comments
- Line comments begin with `--`, `//`, `#`, or case-insensitive `NOTE:`.
- Example:
  ```manifest
  -- This is a comment
  // Also a comment
  # Shell-style comment
  NOTE: Remember to initialize state
  ```

### Literals
- **Strings**: Double-quoted (`"Hello"`) or single-quoted (`'World'`). Supports standard escape sequences (`\"`, `\\`, `\n`).
- **Numbers**: Integers (`42`), floats (`3.14`), negative numbers (`-10`), CSS dimensions (`16px`, `100%`, `2.5rem`, `100vh`).
- **Booleans**: `true`, `false`, `TRUE`, `FALSE`.
- **Null**: `null`, `NULL`.

---

## 3. Structural & Program Declarations

### Application Header
Every Manifest source file begins with an optional `APP` declaration:
```manifest
APP "CounterApplication"
```

### Reactive State
Declared at the top level or within modules:
```manifest
STATE counter: NUMBER = 0
STATE title: TEXT = "My Dashboard"
STATE isVisible: BOOLEAN = true
STATE items: LIST = ["First", "Second", "Third"]
```

### Pages
Pages represent distinct top-level views or screens:
```manifest
PAGE Home
    TEXT "Welcome to the Home Screen"
    BUTTON "Proceed"
        WHEN CLICK
            SHOW "Navigating..."
        END
    END
END
```

### Layout Containers & Components
```manifest
CONTAINER
    STYLE
        WIDTH 100%
        PADDING 24px
        BACKGROUND "#1e293b"
        RADIUS 16px
    END
    TEXT "Card Content"
END

COMPONENT StatCard title value
    CONTAINER
        STYLE
            PADDING 16px
            BACKGROUND "#0f172a"
        END
        TEXT title
        TEXT value
    END
END
```

---

## 4. Statements & Control Flow

### Assignments
```manifest
SET counter TO counter + 1
SET active TO false
```

### Output
```manifest
SHOW "Current Count: " + counter
```

### Conditional Branching
```manifest
IF counter > 10
    SHOW "Count is high"
ELSE
    SHOW "Count is low"
END
```

### Loops
```manifest
-- Fixed repetition
REPEAT 5 TIMES
    SET total TO total + 2
END

-- Array iteration
FOR EACH item IN items
    SHOW item
END
```

### Error Guarding
```manifest
TRY
    CALL riskyOperation
IF FAILED
    SHOW "Operation recovered safely"
END
```

### Actions (Functions)
```manifest
ACTION addNumbers a b
    SET sum TO a + b
    RETURN sum
END

-- Invocation
CALL addNumbers 5 10
```

---

## 5. UI Primitives

- `TEXT <expr>`: Displays reactive text.
- `BUTTON "Label" ... END`: Interactive button with attached `WHEN CLICK` handler.
- `INPUT "Placeholder" INTO <var>`: Two-way reactive text input.
- `IMAGE "src" ALT "alt"`: Image element.
- `LINK "Label" TO "/path"`: Router navigation link.
- `FORM <name> ... END`: Groups inputs with `WHEN SUBMIT` trigger.
- `TABLE ... END`, `DIALOG ... END`, `TABS ... END`, `SIDEBAR ... END`, `BADGE ...`, `PROGRESS ...`, `AVATAR ...`, `ICON ...`: Manifest v0.4 semantic design primitives.

---

## 6. Solana Smart Contract Primitives

Manifest provides native on-chain Solana smart contract declarations that compile directly to Anchor Rust:
```manifest
PROGRAM Counter
    ACCOUNT CounterState
        count: NUMBER
        authority: ADDRESS
    END

    INSTRUCTION initialize
        REQUIRE signer = authority
        SET count = 0
    END

    INSTRUCTION increment
        REQUIRE signer = authority
        SET count = count + 1
    END
END
```

---

## 7. Runtime Interpretation vs JavaScript Target Semantics

A critical architectural distinction in Manifest is the boundary between the **AST Runtime** and the **JavaScript Target Compiler**:

### The AST Interpreter (`manifest-core/src/runtime/runtime.ts`)
- **Execution Model**: Direct tree-walking AST interpreter using an in-memory `Scope` stack and `EventBus`.
- **Environment**: Headless, synchronous/asynchronous TypeScript environment (CLI, unit tests, automated CI testbenches).
- **DOM Independence**: Does **not** manipulate browser DOM elements or inject stylesheets.
- **Capabilities**: Executes arithmetic, assignments, conditional branches, loops, action definitions/calls, and event subscriptions in memory. Collects output via `runtime.getLogs()`.

### The JavaScript Target Compiler (`manifest-core/src/compiler/targets/js-target.ts`)
- **Execution Model**: Transpiles the validated Manifest Intermediate Representation (`IRProgramNode`) into clean browser ES2022 code.
- **Output Artifact**: An encapsulated `startApp(mountElement, { onOutput, onState })` function.
- **DOM Engine**: Directly creates HTML elements (`document.createElement`), binds reactive event listeners (`addEventListener('click', ...)`), updates text nodes on state transitions, and injects scoped CSS classes (`.manifest-page`, `.manifest-container`, `.manifest-button`).
- **Environment**: Sandboxed preview iframe inside Manifest Studio.
