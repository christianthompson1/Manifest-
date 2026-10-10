export interface DiagnosticIssue {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  hint?: string;
  example?: string;
}

export class ManifestError extends Error {
  public line: number;
  public column: number;
  public hint?: string;
  public example?: string;
  public phase?: string;
  public sourceLine?: string;

  constructor(
    message: string,
    line = 1,
    column = 1,
    hint?: string,
    example?: string,
    phase = 'compiler',
    sourceLine?: string
  ) {
    super(message);
    this.name = 'ManifestError';
    this.line = line;
    this.column = column;
    this.hint = hint;
    this.example = example;
    this.phase = phase;
    this.sourceLine = sourceLine;
  }

  public toFormattedString(): string {
    let str = `Manifest Error: ${this.message} (Line ${this.line}, Column ${this.column})`;
    if (this.hint) str += `\nHint: ${this.hint}`;
    if (this.example) str += `\nExample: ${this.example}`;
    return str;
  }
}
