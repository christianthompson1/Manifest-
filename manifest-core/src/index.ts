export * from './lexer/tokens.ts';
export * from './lexer/lexer.ts';
export * from './ast/ast.ts';
export * from './parser/parser.ts';
export * from './validator/validator.ts';
export * from './runtime/runtime.ts';
export * from './runtime/scope.ts';
export * from './runtime/values.ts';
export * from './events/event-bus.ts';
export * from './modules/capabilities.ts';
export * from './errors/manifest-error.ts';
export * from './ir/index.ts';
export * from './compiler/index.ts';
export * from './sourcemap/sourcemap.ts';
export * from './libraries/library-registry.ts';
export * from './solana/solana-ir.ts';
export * from './solana/anchor-generator.ts';
export * from './solana/solana-simulator.ts';
export * from './solana/solana-toolchain.ts';
export * from './compiler/targets/solana-target.ts';

import { Lexer } from './lexer/lexer.ts';
import { Parser } from './parser/parser.ts';
import { Validator } from './validator/validator.ts';
import { Runtime } from './runtime/runtime.ts';
import { TargetCompiler, CompilationResult, TargetCompilerOptions } from './compiler/compiler-interface.ts';
import { CompilerRegistry, compileManifest, generateManifestIR } from './compiler/compiler.ts';

export class Compiler {
  private localCompilers: Map<string, TargetCompiler> = new Map();

  public registerTarget(compiler: TargetCompiler): void {
    this.localCompilers.set(compiler.targetName.toLowerCase(), compiler);
    CompilerRegistry.register(compiler);
  }

  public getSupportedTargets(): string[] {
    const set = new Set<string>(['js', 'solana']);
    for (const k of this.localCompilers.keys()) {
      set.add(k);
    }
    return Array.from(set);
  }

  public async compile(
    source: string,
    targetName = 'js',
    options: TargetCompilerOptions = {}
  ): Promise<CompilationResult> {
    const local = this.localCompilers.get(targetName.toLowerCase());
    if (local) {
      const ir = generateManifestIR(source);
      return await local.compile(ir, options);
    }
    return await compileManifest(source, targetName, options);
  }
}

export interface ExecuteOptions {
  onOutput?: (line: string) => void;
  validate?: boolean;
  throwOnError?: boolean;
}

export async function executeManifest(
  source: string,
  options: ExecuteOptions = {}
): Promise<{
  output: string[];
  validationIssues: any[];
  error?: string;
  scope?: any;
  runtime: Runtime;
}> {
  const output: string[] = [];
  const validationIssues: any[] = [];
  const runtime = new Runtime();

  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, source);
    const ast = parser.parse();

    if (options.validate !== false) {
      const validator = new Validator(ast, source);
      const valRes = validator.validate();
      if (!valRes.isValid) {
        validationIssues.push(...valRes.issues);
      }
    }

    await runtime.execute(ast);
    const logs = runtime.getLogs();
    for (const log of logs) {
      output.push(log);
      options.onOutput?.(log);
    }

    return {
      output,
      validationIssues,
      scope: runtime.getGlobalScope(),
      runtime,
    };
  } catch (err: any) {
    if (options.throwOnError !== false) {
      throw err;
    }
    return {
      output,
      validationIssues,
      error: err.message || String(err),
      scope: runtime.getGlobalScope(),
      runtime,
    };
  }
}
