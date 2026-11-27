/**
 * Manifest Autocomplete & Hover Intelligence Engine for CodeMirror 6
 * Supports both Syntax Profiles (Beginner & Professional), std::* intrinsics,
 * live AST symbol extraction, and type/effect/capability hover tooltips.
 */

import { Completion, CompletionContext, CompletionResult, snippetCompletion } from '@codemirror/autocomplete';
import { EditorView, hoverTooltip, Tooltip } from '@codemirror/view';
import {
  detectSyntaxProfile,
  isSolanaProgramSource,
  checkManifestSource,
  STD_INTRINSICS,
  lookupStdIntrinsic,
  formatSemanticType,
} from '../../../manifest-core/src/index.ts';

export interface ManifestCompletionItem {
  label: string;
  type: 'keyword' | 'function' | 'variable' | 'class' | 'constant' | 'type';
  detail?: string;
  info?: string;
  template?: string;
  boost?: number;
}

class ManifestCompletionRegistry {
  private customCompletions: ManifestCompletionItem[] = [];

  public register(item: ManifestCompletionItem) {
    this.customCompletions.push(item);
  }

  public getCompletions(): ManifestCompletionItem[] {
    return [...this.customCompletions];
  }
}

export const completionRegistry = new ManifestCompletionRegistry();

// Professional Profile Completions (v1.0)
const PROFESSIONAL_COMPLETIONS: ManifestCompletionItem[] = [
  {
    label: 'module',
    type: 'keyword',
    detail: 'module name;',
    info: 'Declare the module namespace for this file.',
    template: 'module ${1:main};',
    boost: 96,
  },
  {
    label: 'requires',
    type: 'keyword',
    detail: 'requires console, fs.read;',
    info: 'Declare host capabilities required by this module.',
    template: 'requires ${1:console};',
    boost: 95,
  },
  {
    label: 'denies',
    type: 'keyword',
    detail: 'denies net, fs.write;',
    info: 'Explicitly forbid capabilities across the entire module call graph.',
    template: 'denies ${1:net};',
    boost: 92,
  },
  {
    label: 'provides',
    type: 'keyword',
    detail: 'provides service_cap;',
    info: 'Declare capabilities exported/provided by this module.',
    template: 'provides ${1:compute};',
    boost: 88,
  },
  {
    label: 'import',
    type: 'keyword',
    detail: 'import { sym } from "./mod";',
    info: 'Import exported symbols from another Manifest module.',
    template: 'import { ${1:helper} } from "./${2:utils}";',
    boost: 90,
  },
  {
    label: 'export fn',
    type: 'function',
    detail: 'export fn name(...) -> T { ... }',
    info: 'Define an exported function visible to importing modules.',
    template: 'export fn ${1:compute}(${2:x}: ${3:i64}) -> ${4:i64} {\n    return ${2:x};\n}',
    boost: 94,
  },
  {
    label: 'fn',
    type: 'function',
    detail: 'fn name(params) -> ReturnType { ... }',
    info: 'Define a statically typed Manifest function (Professional Profile).',
    template: 'fn ${1:main}() -> ${2:i64} effects(${3:console}) {\n    console.print("${4:Hello Manifest}");\n    return 0;\n}',
    boost: 96,
  },
  {
    label: 'let',
    type: 'keyword',
    detail: 'let name: T = expr;',
    info: 'Declare an immutable local or module binding.',
    template: 'let ${1:value}: ${2:i64} = ${3:0};',
    boost: 93,
  },
  {
    label: 'let mut',
    type: 'keyword',
    detail: 'let mut name: T = expr;',
    info: 'Declare a mutable binding.',
    template: 'let mut ${1:counter}: ${2:i64} = ${3:0};',
    boost: 92,
  },
  {
    label: 'const',
    type: 'constant',
    detail: 'const NAME: T = expr;',
    info: 'Declare an immutable compile-time constant.',
    template: 'const ${1:MAX_ITEMS}: ${2:i64} = ${3:100};',
    boost: 88,
  },
  {
    label: 'struct',
    type: 'class',
    detail: 'struct Name { field: Type }',
    info: 'Define a nominal product record type.',
    template: 'struct ${1:Point} {\n    ${2:x}: ${3:i64},\n    ${4:y}: ${5:i64},\n}',
    boost: 90,
  },
  {
    label: 'enum',
    type: 'class',
    detail: 'enum Name { Variant(T) }',
    info: 'Define a tagged algebraic union type checked exhaustively by match.',
    template: 'enum ${1:Status} {\n    ${2:Active},\n    ${3:Error}(${4:str}),\n}',
    boost: 90,
  },
  {
    label: 'match',
    type: 'keyword',
    detail: 'match value { Pattern => expr }',
    info: 'Exhaustive pattern matching over enums, Result, and literals.',
    template: 'match ${1:value} {\n    ${2:Ok(v)} => {\n        ${3:return v;}\n    },\n    ${4:Err(e)} => {\n        ${5:return 0;}\n    },\n}',
    boost: 91,
  },
  {
    label: 'if',
    type: 'keyword',
    detail: 'if cond { ... } else { ... }',
    info: 'Strict boolean conditional statement.',
    template: 'if ${1:condition} {\n    ${2}\n} else {\n    ${3}\n}',
    boost: 89,
  },
  {
    label: 'for',
    type: 'keyword',
    detail: 'for item in items { ... }',
    info: 'Iterate over elements of a typed array.',
    template: 'for ${1:item} in ${2:items} {\n    ${3}\n}',
    boost: 88,
  },
  {
    label: 'while',
    type: 'keyword',
    detail: 'while cond { ... }',
    info: 'Loop while a strict boolean condition holds.',
    template: 'while ${1:i < 10} {\n    ${2}\n}',
    boost: 87,
  },
  {
    label: 'effects',
    type: 'keyword',
    detail: 'effects(console, fs.read)',
    info: 'Explicit capability effect clause on a function signature.',
    template: 'effects(${1:console})',
    boost: 85,
  },
  { label: 'i64', type: 'type', detail: '64-bit signed checked integer', info: 'Checked 64-bit integer (overflow traps deterministically in MVM).', boost: 89 },
  { label: 'f64', type: 'type', detail: 'IEEE-754 64-bit float', info: '64-bit floating-point number.', boost: 89 },
  { label: 'bool', type: 'type', detail: 'Boolean (true | false)', info: 'Strict boolean primitive (no truthy/falsy coercion).', boost: 89 },
  { label: 'str', type: 'type', detail: 'UTF-8 immutable string', info: 'Immutable UTF-8 string value.', boost: 89 },
  { label: 'void', type: 'type', detail: 'Unit / void return type', info: 'Indicates a function returns unit.', boost: 86 },
  { label: 'Result', type: 'type', detail: 'Result<T, E>', info: 'Explicit recoverable error type with Ok(v) and Err(e) variants.', template: 'Result<${1:i64}, ${2:str}>', boost: 88 },
];

// Beginner Profile Completions (v1.0)
const BEGINNER_V1_COMPLETIONS: ManifestCompletionItem[] = [
  {
    label: 'MODULE',
    type: 'keyword',
    detail: 'MODULE name',
    info: 'Declare the module name (Beginner Profile).',
    template: 'MODULE ${1:main}',
    boost: 95,
  },
  {
    label: 'REQUIRES',
    type: 'keyword',
    detail: 'REQUIRES console',
    info: 'Declare host capabilities required by this module.',
    template: 'REQUIRES ${1:console}',
    boost: 94,
  },
  {
    label: 'DENIES',
    type: 'keyword',
    detail: 'DENIES net',
    info: 'Explicitly forbid capabilities across this module.',
    template: 'DENIES ${1:net}',
    boost: 91,
  },
  {
    label: 'FUNCTION',
    type: 'function',
    detail: 'FUNCTION name(...) RETURNS Type ... END',
    info: 'Define a statically typed function (Beginner Profile) lowering to the exact same IR as fn.',
    template: 'FUNCTION ${1:main}() RETURNS ${2:Int} EFFECTS ${3:console}\n    SHOW "${4:Hello Manifest}"\n    RETURN 0\nEND',
    boost: 95,
  },
  {
    label: 'LET',
    type: 'keyword',
    detail: 'LET name: Type = value',
    info: 'Declare an immutable variable binding (Beginner Profile).',
    template: 'LET ${1:total}: ${2:Int} = ${3:0}',
    boost: 93,
  },
  {
    label: 'LET MUTABLE',
    type: 'keyword',
    detail: 'LET MUTABLE name: Type = value',
    info: 'Declare a mutable variable binding (Beginner Profile).',
    template: 'LET MUTABLE ${1:count}: ${2:Int} = ${3:0}',
    boost: 92,
  },
  {
    label: 'CONSTANT',
    type: 'constant',
    detail: 'CONSTANT NAME: Type = value',
    info: 'Declare an immutable constant.',
    template: 'CONSTANT ${1:LIMIT}: ${2:Int} = ${3:100}',
    boost: 88,
  },
  {
    label: 'STRUCT',
    type: 'class',
    detail: 'STRUCT Name ... END',
    info: 'Define a typed record structure (Beginner Profile).',
    template: 'STRUCT ${1:Item}\n    ${2:id}: ${3:Int}\n    ${4:label}: ${5:Text}\nEND',
    boost: 90,
  },
  {
    label: 'ENUM',
    type: 'class',
    detail: 'ENUM Name ... END',
    info: 'Define a tagged union type (Beginner Profile).',
    template: 'ENUM ${1:Outcome}\n    ${2:Success}(${3:Int})\n    ${4:Failure}(${5:Text})\nEND',
    boost: 90,
  },
  {
    label: 'MATCH',
    type: 'keyword',
    detail: 'MATCH expr ... WHEN Pattern ... END',
    info: 'Exhaustive pattern match block (Beginner Profile).',
    template: 'MATCH ${1:result}\n    WHEN Ok(val)\n        RETURN val\n    WHEN Err(msg)\n        RETURN 0\nEND',
    boost: 90,
  },
  { label: 'Int', type: 'type', detail: '64-bit signed checked integer (same as i64)', info: 'Normalizes to i64 in SemanticModule.', boost: 89 },
  { label: 'Float', type: 'type', detail: '64-bit float (same as f64)', info: 'Normalizes to f64 in SemanticModule.', boost: 89 },
  { label: 'Bool', type: 'type', detail: 'Boolean (same as bool)', info: 'Normalizes to bool in SemanticModule.', boost: 89 },
  { label: 'Text', type: 'type', detail: 'UTF-8 string (same as str)', info: 'Normalizes to str in SemanticModule.', boost: 89 },
  { label: 'Void', type: 'type', detail: 'Void unit return type', info: 'Normalizes to void in SemanticModule.', boost: 86 },
];

// Standard Library Intrinsics Completions
const STD_COMPLETIONS: ManifestCompletionItem[] = STD_INTRINSICS.map((sig) => ({
  label: sig.symbol,
  type: 'function',
  detail: `(${sig.params.map(formatSemanticType).join(', ')}) -> ${formatSemanticType(sig.returnType)} [${sig.capability}]`,
  info:
    sig.capability !== 'pure'
      ? `Standard library intrinsic (${sig.aliases.join(', ')}) • Requires capability: ${sig.capability}`
      : `Pure deterministic standard library intrinsic (${sig.aliases.join(', ')})`,
  boost: 84,
}));

// Beginner v1 Statements & Standalone Solana Contract Completions
const BEGINNER_AND_SOLANA_COMPLETIONS: ManifestCompletionItem[] = [
  {
    label: 'SET',
    type: 'keyword',
    detail: 'SET variable = value',
    info: 'Mutate a mutable variable (Beginner Profile).',
    template: 'SET ${1:variable} = ${2:0}',
    boost: 82,
  },
  {
    label: 'SHOW',
    type: 'keyword',
    detail: 'SHOW expression',
    info: 'Emit value to standard output / console capability.',
    template: 'SHOW ${1:"Hello Manifest"}',
    boost: 85,
  },
  {
    label: 'IF',
    type: 'keyword',
    detail: 'IF condition ... END',
    info: 'Conditional branch statement (Beginner Profile).',
    template: 'IF ${1:condition}\n    ${2:SHOW "True"}\nELSE\n    ${3:SHOW "False"}\nEND',
    boost: 84,
  },
  {
    label: 'REPEAT',
    type: 'keyword',
    detail: 'REPEAT N TIMES ... END',
    info: 'Bounded loop statement.',
    template: 'REPEAT ${1:3} TIMES\n    ${2:SHOW "Step"}\nEND',
    boost: 80,
  },
  {
    label: 'FOR EACH',
    type: 'keyword',
    detail: 'FOR EACH item IN list ... END',
    info: 'Iterate through each element in an array.',
    template: 'FOR EACH ${1:item} IN ${2:items}\n    SHOW ${1:item}\nEND',
    boost: 80,
  },
  {
    label: 'PROGRAM',
    type: 'class',
    detail: 'PROGRAM Name ... END',
    info: 'Declare a Solana on-chain smart contract compiled to Anchor Rust.',
    template: 'PROGRAM ${1:Counter}\n    ACCOUNT ${1:Counter}State\n        count: NUMBER\n        authority: ADDRESS\n    END\n\n    INSTRUCTION increment\n        REQUIRE signer = authority\n        SET count = count + 1\n    END\nEND',
    boost: 80,
  },
];

async function extractDocumentScope(docText: string): Promise<ManifestCompletionItem[]> {
  const items: ManifestCompletionItem[] = [];
  const seen = new Set<string>();

  const addUnique = (item: ManifestCompletionItem) => {
    if (!seen.has(item.label)) {
      seen.add(item.label);
      items.push(item);
    }
  };

  // Query authoritative Rust compiler engine AST summary first
  if (!isSolanaProgramSource(docText)) {
    try {
      const checked = await checkManifestSource(docText);
      if (checked.astSummary) {
        for (const fn of checked.astSummary.functions) {
          const paramsStr = fn.params
            .map((p) => `${p.name}: ${p.typeStr}`)
            .join(', ');
          addUnique({
            label: fn.name,
            type: 'function',
            detail: `fn(${paramsStr}) -> ${fn.returnTypeStr}`,
            info: fn.effects.length > 0 ? `Effects: ${fn.effects.join(', ')}` : 'Pure function',
            boost: 75,
          });
        }
        for (const st of checked.astSummary.structs) {
          addUnique({
            label: st.name,
            type: 'class',
            detail: `struct (${st.fields.length} fields)`,
            info: `Fields: ${st.fields.map((f) => `${f.name}: ${f.typeStr}`).join(', ')}`,
            boost: 74,
          });
        }
        for (const en of checked.astSummary.enums) {
          addUnique({
            label: en.name,
            type: 'class',
            detail: `enum (${en.variants.join(' | ')})`,
            boost: 74,
          });
        }
        for (const c of checked.astSummary.constants) {
          addUnique({
            label: c.name,
            type: 'constant',
            detail: c.typeStr,
            boost: 71,
          });
        }
        for (const g of checked.astSummary.globals) {
          addUnique({
            label: g.name,
            type: 'variable',
            detail:
              g.typeStr !== 'any'
                ? g.typeStr
                : g.mutable
                  ? 'mut var'
                  : 'let binding',
            boost: 70,
          });
        }
      }
    } catch {
      // Ignore transient parse failures while user is mid-keystroke; regex token scan below keeps typing responsive
    }
  }

  let match: RegExpExecArray | null;
  const fnRegex = /\b(?:fn|FUNCTION)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((match = fnRegex.exec(docText)) !== null) {
    addUnique({ label: match[1], type: 'function', detail: 'Function', boost: 68 });
  }

  const varRegex = /\b(?:let\s+mut|let|const|LET\s+MUTABLE|LET|CONSTANT|SET)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((match = varRegex.exec(docText)) !== null) {
    addUnique({ label: match[1], type: 'variable', detail: 'Binding', boost: 64 });
  }

  return items;
}

export async function manifestAutocomplete(context: CompletionContext): Promise<CompletionResult | null> {
  const word = context.matchBefore(/[a-zA-Z_][a-zA-Z0-9_.:]*/);
  if (!word && !context.explicit) {
    return null;
  }

  const docText = context.state.doc.toString();
  const isSolana = isSolanaProgramSource(docText);
  const detectedProfile = detectSyntaxProfile(docText);
  const scopeItems = await extractDocumentScope(docText);

  let pool: ManifestCompletionItem[];
  if (isSolana) {
    pool = [...BEGINNER_AND_SOLANA_COMPLETIONS, ...completionRegistry.getCompletions(), ...scopeItems];
  } else if (detectedProfile === 'professional') {
    pool = [...PROFESSIONAL_COMPLETIONS, ...STD_COMPLETIONS, ...completionRegistry.getCompletions(), ...scopeItems];
  } else {
    pool = [...BEGINNER_V1_COMPLETIONS, ...PROFESSIONAL_COMPLETIONS, ...STD_COMPLETIONS, ...BEGINNER_AND_SOLANA_COMPLETIONS, ...completionRegistry.getCompletions(), ...scopeItems];
  }

  const deduped = new Map<string, ManifestCompletionItem>();
  for (const item of pool) {
    if (!deduped.has(item.label)) {
      deduped.set(item.label, item);
    }
  }

  const options: Completion[] = Array.from(deduped.values()).map((item) => {
    if (item.template) {
      return snippetCompletion(item.template, {
        label: item.label,
        type: item.type,
        detail: item.detail,
        info: item.info,
        boost: item.boost,
      });
    }
    return {
      label: item.label,
      type: item.type,
      detail: item.detail,
      info: item.info,
      boost: item.boost,
    };
  });

  return {
    from: word ? word.from : context.pos,
    options,
    validFor: /^[a-zA-Z0-9_.:]*$/,
  };
}

const CAPABILITY_DOCS: Record<string, string> = {
  console: 'Host Capability `console`: Permits standard output logging (SHOW, console.print, std::io::println).',
  'fs.read': 'Host Capability `fs.read`: Permits reading files from the sandboxed workspace filesystem.',
  'fs.write': 'Host Capability `fs.write`: Permits creating or modifying files in the workspace filesystem.',
  net: 'Host Capability `net`: Permits outbound HTTP/network requests (std::net::http_get). Denied by default.',
  time: 'Host Capability `time`: Permits reading wall-clock or monotonic timestamps (std::time::now_ms).',
  crypto: 'Host Capability `crypto`: Permits cryptographic hashing and digest intrinsics (std::crypto::sha256).',
  db: 'Host Capability `db`: Permits key-value store reads/writes (std::db::get, std::db::put).',
};

/**
 * CodeMirror 6 Hover Tooltip providing static types, function effects, and capability explanations.
 */
export const manifestHoverTooltip = hoverTooltip(async (view: EditorView, pos: number): Promise<Tooltip | null> => {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;

  let start = offset;
  let end = offset;
  while (start > 0 && /[a-zA-Z0-9_.:]/.test(text[start - 1])) start--;
  while (end < text.length && /[a-zA-Z0-9_.:]/.test(text[end])) end++;
  if (start === end) return null;

  const token = text.slice(start, end);
  const fullSource = doc.toString();

  let header = '';
  let body = '';

  const stdSig = lookupStdIntrinsic(token);
  if (CAPABILITY_DOCS[token]) {
    header = `capability ${token}`;
    body = CAPABILITY_DOCS[token];
  } else if (stdSig) {
    header = `fn ${stdSig.symbol}(${stdSig.params.map(formatSemanticType).join(', ')}) -> ${formatSemanticType(stdSig.returnType)}`;
    body =
      stdSig.capability !== 'pure'
        ? `Standard library intrinsic • Requires capability: ${stdSig.capability}`
        : 'Pure deterministic standard library intrinsic';
  } else if (!isSolanaProgramSource(fullSource)) {
    try {
      const checked = await checkManifestSource(fullSource);
      if (checked.astSummary) {
        const fnSig = checked.astSummary.functions.find((f) => f.name === token);
        if (fnSig) {
          const auditFn = checked.capabilityAudit?.functions.find((s) => s.name === token);
          const effectsLabel =
            auditFn && auditFn.inferredEffects.length > 0
              ? ` effects(${auditFn.inferredEffects.join(', ')})`
              : fnSig.effects.length > 0
                ? ` effects(${fnSig.effects.join(', ')})`
                : ' [pure]';
          const paramsText = fnSig.params
            .map((p) => `${p.name}: ${p.typeStr}`)
            .join(', ');
          header = `fn ${token}(${paramsText}) -> ${fnSig.returnTypeStr}${effectsLabel}`;
          body = `Verified in ${checked.resolvedProfile} syntax profile (${checked.compilerEngine || 'rust-manifest-compiler'}).`;
        } else {
          const stType = checked.astSummary.structs.find((s) => s.name === token);
          if (stType) {
            header = `struct ${stType.name}`;
            body = `Fields: ${stType.fields
              .map((f) => `${f.name}: ${f.typeStr}`)
              .join(', ')}`;
          } else {
            const enType = checked.astSummary.enums.find((e) => e.name === token);
            if (enType) {
              header = `enum ${enType.name}`;
              body = `Variants: ${enType.variants.join(' | ')}`;
            }
          }
        }
      }
    } catch {
      // Ignore transient parse failures during hover
    }
  }

  if (!header) return null;

  return {
    pos: line.from + start,
    end: line.from + end,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.style.padding = '6px 10px';
      dom.style.maxWidth = '380px';
      dom.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
      dom.style.fontSize = '11px';

      const titleEl = document.createElement('div');
      titleEl.style.color = '#9cdcfe';
      titleEl.style.fontWeight = '600';
      titleEl.textContent = header;
      dom.appendChild(titleEl);

      if (body) {
        const descEl = document.createElement('div');
        descEl.style.color = '#cccccc';
        descEl.style.marginTop = '4px';
        descEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        descEl.textContent = body;
        dom.appendChild(descEl);
      }
      return { dom };
    },
  };
});
