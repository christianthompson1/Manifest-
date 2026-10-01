/**
 * Manifest Compiler Interfaces and Target Abstraction
 * Defines clean decoupled abstractions for targeting multiple runtimes/backends.
 */

import { ProgramNode } from '../ast/ast.ts';
import { IRProgramNode } from '../ir/ir.ts';

export interface CompilationDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  target?: string;
  hint?: string;
}

export interface GeneratedArtifact {
  fileName: string;
  content: string;
  fileType: 'javascript' | 'typescript' | 'json' | 'html' | 'text' | 'binary';
}

export interface CompilationResult {
  success: boolean;
  target: string;
  outputCode?: string;
  artifacts: GeneratedArtifact[];
  diagnostics: CompilationDiagnostic[];
  ir?: IRProgramNode;
}

export interface TargetCompilerOptions {
  moduleFormat?: 'esm' | 'cjs' | 'iife';
  minify?: boolean;
  sourceMap?: boolean;
  includeRuntime?: boolean;
  runtimeImportPath?: string;
  strictTypes?: boolean;
}

/**
 * Interface implemented by any backend/target code generator.
 */
export interface TargetCompiler {
  readonly targetName: string;
  readonly fileExtension: string;
  compile(ir: IRProgramNode, options?: TargetCompilerOptions): Promise<CompilationResult> | CompilationResult;
}

/**
 * High-level compiler interface that orchestrates the entire compilation pipeline:
 * Manifest Source -> Lexer -> Parser -> Validator -> IR Builder -> Target Compiler.
 */
export interface ManifestCompiler {
  compile(source: string, targetName: string, options?: TargetCompilerOptions): Promise<CompilationResult>;
  compileAST(ast: ProgramNode, targetName: string, options?: TargetCompilerOptions): Promise<CompilationResult>;
  compileIR(ir: IRProgramNode, targetName: string, options?: TargetCompilerOptions): Promise<CompilationResult>;
  registerTarget(target: TargetCompiler): void;
  getSupportedTargets(): string[];
}
