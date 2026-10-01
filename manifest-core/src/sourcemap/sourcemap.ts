/**
 * Manifest Source Map Generator & Error Translator
 * Maps Manifest source code lines and columns to target generated code lines (JS, Rust),
 * allowing target compiler diagnostics or runtime exceptions to be mapped back to
 * original Manifest source lines for clean beginner-friendly developer feedback.
 */

export interface SourceMapping {
  manifestLine: number;
  manifestColumn: number;
  targetLine: number;
  targetColumn: number;
  name?: string;
}

export interface TargetError {
  target: 'js' | 'rust';
  line: number;
  column?: number;
  message: string;
}

export interface MappedManifestError {
  manifestLine: number;
  manifestColumn: number;
  originalMessage: string;
  formattedMessage: string;
  sourceLineSnippet?: string;
  target: 'js' | 'rust';
}

export class SourceMapGenerator {
  private mappings: SourceMapping[] = [];
  private sourceLines: string[] = [];

  constructor(manifestSource: string = '') {
    this.sourceLines = manifestSource.split('\n');
  }

  public setSource(manifestSource: string) {
    this.sourceLines = manifestSource.split('\n');
    this.mappings = [];
  }

  public addMapping(
    manifestLine: number,
    manifestColumn: number,
    targetLine: number,
    targetColumn: number,
    name?: string
  ) {
    this.mappings.push({
      manifestLine: Math.max(1, manifestLine),
      manifestColumn: Math.max(1, manifestColumn),
      targetLine: Math.max(1, targetLine),
      targetColumn: Math.max(1, targetColumn),
      name,
    });
  }

  public getMappings(): readonly SourceMapping[] {
    return this.mappings;
  }

  /**
   * Translates a target generated code line back to original Manifest line
   */
  public findManifestPosition(targetLine: number): { line: number; column: number } | null {
    if (this.mappings.length === 0) return null;

    // Find the closest mapping with targetLine <= given targetLine
    let closest: SourceMapping | null = null;
    let minDiff = Infinity;

    for (const m of this.mappings) {
      if (m.targetLine === targetLine) {
        return { line: m.manifestLine, column: m.manifestColumn };
      }
      const diff = targetLine - m.targetLine;
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
        closest = m;
      }
    }

    if (closest) {
      return { line: closest.manifestLine, column: closest.manifestColumn };
    }

    // Fallback to first mapping
    return { line: this.mappings[0].manifestLine, column: this.mappings[0].manifestColumn };
  }

  /**
   * Maps a target compiler error or runtime error back to Manifest source
   */
  public mapError(targetError: TargetError): MappedManifestError {
    const pos = this.findManifestPosition(targetError.line) || { line: 1, column: 1 };
    const snippet = this.sourceLines[pos.line - 1] || '';

    return {
      manifestLine: pos.line,
      manifestColumn: pos.column,
      originalMessage: targetError.message,
      formattedMessage: `Manifest [Line ${pos.line}]: ${targetError.message}`,
      sourceLineSnippet: snippet.trim(),
      target: targetError.target,
    };
  }

  public serialize(): string {
    return JSON.stringify({
      version: 3,
      mappingsCount: this.mappings.length,
      mappings: this.mappings,
    }, null, 2);
  }
}
