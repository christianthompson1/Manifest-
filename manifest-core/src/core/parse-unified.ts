import { SemanticModule } from './ast-v2.ts';
import { BeginnerParser } from './beginner-parser.ts';
import { ProfessionalParser } from './professional-parser.ts';
import { detectSyntaxProfile, SyntaxProfile } from './profile.ts';

export interface ParseOptions {
  profile?: SyntaxProfile | 'auto';
  file?: string;
}

export function parseSemanticModule(source: string, options: ParseOptions = {}): SemanticModule {
  const resolvedProfile = detectSyntaxProfile(source, options.profile);
  if (resolvedProfile === 'professional') {
    return new ProfessionalParser(source, options.file).parseModule();
  }
  return new BeginnerParser(source, options.file).parseModule();
}
