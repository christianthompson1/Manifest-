/**
 * Manifest Core v0.1
 * Main Entry Point and Public API
 */

export * from './lexer/tokens.ts';
export * from './lexer/lexer.ts';
export * from './ast/ast.ts';
export * from './parser/parser.ts';
export * from './validator/validator.ts';
export * from './runtime/values.ts';
export * from './runtime/scope.ts';
export * from './runtime/runtime.ts';
export * from './events/event-bus.ts';
export * from './modules/capabilities.ts';
export * from './errors/manifest-error.ts';
export * from './ir/index.ts';
export * from './compiler/index.ts';

import { Lexer } from './lexer/lexer.ts';
import { Parser } from './parser/parser.ts';
import { Validator, ValidationIssue } from './validator/validator.ts';
import { Runtime } from './runtime/runtime.ts';
import { ProgramNode } from './ast/ast.ts';
import { Token } from './lexer/tokens.ts';
import { IRProgramNode } from './ir/ir.ts';
import { IRBuilder } from './ir/ir-builder.ts';
import { Compiler } from './compiler/compiler.ts';
import { CompilationResult, TargetCompilerOptions } from './compiler/compiler-interface.ts';

export interface ExecuteResult {
  output: string[];
  runtime: Runtime;
  program: ProgramNode;
  tokens: Token[];
  validationIssues: ValidationIssue[];
}

/**
 * Runs a complete Manifest source string from start to finish via interpreter.
 * Lexes -> Parses -> Validates -> Executes -> Emits app.starts -> Returns output.
 */
export async function executeManifest(
  source: string,
  options?: {
    onOutput?: (line: string) => void;
    validate?: boolean;
  }
): Promise<ExecuteResult> {
  const output: string[] = [];

  const handleOutput = (text: string) => {
    output.push(text);
    if (options?.onOutput) {
      options.onOutput(text);
    }
  };

  // 1. Lexer
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();

  // 2. Parser
  const parser = new Parser(tokens, source);
  const program = parser.parse();

  // 3. Validator (optional static check)
  const validator = new Validator(program, source);
  const validationResult = validator.validate();
  if (options?.validate !== false) {
    validator.ensureValid();
  }

  // 4. Runtime
  const runtime = new Runtime(handleOutput);
  await runtime.execute(program);

  return {
    output,
    runtime,
    program,
    tokens,
    validationIssues: validationResult.issues,
  };
}

/**
 * Parses and validates Manifest source without executing it.
 * Useful for IDE inspection, syntax checkers, and AST visualization.
 */
export function inspectManifest(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, source);
  const program = parser.parse();
  const validator = new Validator(program, source);
  const validation = validator.validate();

  return {
    tokens,
    program,
    validation,
  };
}

/**
 * Transforms Manifest source or AST into target-agnostic Manifest IR.
 */
export function generateManifestIR(sourceOrAst: string | ProgramNode): IRProgramNode {
  let ast: ProgramNode;
  if (typeof sourceOrAst === 'string') {
    const lexer = new Lexer(sourceOrAst);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, sourceOrAst);
    ast = parser.parse();
    const validator = new Validator(ast, sourceOrAst);
    validator.ensureValid();
  } else {
    ast = sourceOrAst;
  }

  const builder = new IRBuilder();
  return builder.build(ast);
}

/**
 * Compiles Manifest source into target code (e.g. JavaScript).
 */
export async function compileManifest(
  source: string,
  target: string = 'js',
  options?: TargetCompilerOptions
): Promise<CompilationResult> {
  const compiler = new Compiler();
  return await compiler.compile(source, target, options);
}
