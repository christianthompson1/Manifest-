/**
 * Manifest Core v0.1 - Human-Friendly Error System
 * Designed specifically for beginners and clear diagnostics.
 */

export interface SourceLocation {
  line: number;
  column: number;
}

export interface ManifestErrorOptions {
  message: string;
  line: number;
  column?: number;
  sourceLine?: string;
  expected?: string;
  found?: string;
  example?: string;
  hint?: string;
  phase?: 'lexer' | 'parser' | 'validator' | 'runtime';
}

export class ManifestError extends Error {
  public readonly line: number;
  public readonly column: number;
  public readonly sourceLine?: string;
  public readonly expected?: string;
  public readonly found?: string;
  public readonly example?: string;
  public readonly hint?: string;
  public readonly phase: 'lexer' | 'parser' | 'validator' | 'runtime';

  constructor(options: ManifestErrorOptions) {
    super(options.message);
    this.name = 'ManifestError';
    this.line = options.line;
    this.column = options.column ?? 1;
    this.sourceLine = options.sourceLine;
    this.expected = options.expected;
    this.found = options.found;
    this.example = options.example;
    this.hint = options.hint;
    this.phase = options.phase ?? 'parser';
  }

  /**
   * Formats the error into an understandable, beginner-friendly message.
   */
  public toFormattedString(): string {
    const lines: string[] = [];

    lines.push(`Manifest Error — line ${this.line}${this.column > 1 ? `, column ${this.column}` : ''}`);
    lines.push('');
    lines.push(this.message);

    if (this.sourceLine !== undefined && this.sourceLine.trim().length > 0) {
      lines.push('');
      lines.push('Line ' + this.line + ': ' + this.sourceLine);
      if (this.column > 0) {
        const indent = ' '.repeat(('Line ' + this.line + ': ').length + Math.max(0, this.column - 1));
        lines.push(`${indent}^ here`);
      }
    }

    if (this.expected) {
      lines.push('');
      lines.push(`I expected: ${this.expected}`);
    }

    if (this.found) {
      lines.push(`What I found: ${this.found}`);
    }

    if (this.example) {
      lines.push('');
      lines.push('Example:');
      lines.push(this.example);
    }

    if (this.hint) {
      lines.push('');
      lines.push(`Tip: ${this.hint}`);
    }

    return lines.join('\n');
  }
}
