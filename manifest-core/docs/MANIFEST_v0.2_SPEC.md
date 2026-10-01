# Manifest Application Language v0.2 — Foundation Specification

## 1. Overview
Manifest Application Language v0.2 extends the core Manifest compiler prototype into a real application-development language. It introduces a minimal, human-readable, and target-agnostic set of interactive application primitives while preserving Manifest's existing multi-stage pipeline:

```
Manifest Source (.manifest)
  → Lexer (Tokens)
  → Parser (AST)
  → Semantic Validator (Type & Scope Safety)
  → Manifest IR (Target-Agnostic Application IR)
  → Target Compiler (JavaScript / Web Target)
  → Reactive Browser Runtime
```

---

## 2. Core Application Primitives

### 2.1 `APP`
Defines the top-level application name and manifest scope.
```manifest
APP "Counter"
```

### 2.2 `PAGE`
Defines an application view or page container.
```manifest
PAGE Home
    TEXT "Welcome to Manifest"
END

PAGE About ROUTE "/about"
    TEXT "About Page"
END
```

### 2.3 `STATE`
Declares reactive state variables inside pages or application scope.
```manifest
STATE count TO 0
STATE username TO "Guest"
```

### 2.4 `TEXT`
Renders reactive textual content or evaluated expressions.
```manifest
TEXT "Hello World"
TEXT "Count: " + count
```

### 2.5 `BUTTON`
Renders an interactive button with optional click event handling.
```manifest
BUTTON "Increment"
    WHEN CLICK
        SET count TO count + 1
    END
END
```

### 2.6 `INPUT`
Renders an input field bound directly to a state variable.
```manifest
INPUT "Enter your name" INTO username
```

### 2.7 `IMAGE`
Renders an image asset with optional alt text.
```manifest
IMAGE "https://example.com/logo.png" ALT "Application Logo"
```

### 2.8 `FORM`
Groups input fields and actions with submit handling.
```manifest
FORM ContactForm
    INPUT "Enter email" INTO email
    BUTTON "Send"
    WHEN SUBMIT
        SHOW "Submitted: " + email
    END
END
```

### 2.9 `ROUTE`
Maps URL route paths to designated target pages.
```manifest
ROUTE "/" TO Home
ROUTE "/settings" TO Settings
```

---

## 3. Reactive State Model
When a state variable is mutated via `SET`:
```manifest
SET count TO count + 1
```
The compiled runtime automatically triggers `__manifest.notifyState()`, which notifies listeners and re-renders active UI views reflecting the new state values.

---

## 4. Target-Agnostic Manifest IR
Application primitives are represented in the IR without coupling to any web framework:
- `IRPage`
- `IRText`
- `IRButton`
- `IRInput`
- `IRImage`
- `IRForm`
- `IRState`
- `IRRoute`
- `IREventHandler`

This ensures that future native targets (e.g. mobile, desktop, terminal UI, WebAssembly) can consume the same Manifest IR.

---

## 5. Web Target & Lightweight Runtime
The JavaScript target compiles Manifest IR into modern ECMAScript with an embedded lightweight runtime shim:
- **Zero React Dependency**: Manifest creates real DOM nodes directly.
- **State Management**: Reactive dictionary storing state values with notify hooks.
- **Event Dispatching**: Async event loop mapping DOM events (`click`, `input`, `submit`) to Manifest IR event blocks.
