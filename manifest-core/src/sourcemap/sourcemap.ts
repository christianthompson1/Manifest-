export interface SourceMapping {
  generatedLine: number;
  generatedColumn: number;
  sourceLine: number;
  sourceColumn: number;
  name?: string;
}

export class SourceMapGenerator {
  private file: string;
  private mappings: SourceMapping[] = [];

  constructor(file = 'output.js') {
    this.file = file;
  }

  public addMapping(mapping: SourceMapping): void {
    this.mappings.push(mapping);
  }

  public toJSON(): any {
    return {
      version: 3,
      file: this.file,
      mappings: this.mappings,
    };
  }
}
