/**
 * Manifest Studio - Multi-Language Editor Extension Registry
 * Dynamically provides syntax highlighting, parsing, and language tools
 * based on file type without forcing non-Manifest files into Manifest compilation.
 */

import { Extension } from '@codemirror/state';
import { manifestSyntaxHighlighting } from './manifest-language.ts';
import { FileLanguage } from '../types.ts';
import { LanguageRegistry } from '../languages/language-registry.ts';

/**
 * Maps a file extension or filename to a recognized FileLanguage.
 */
export function detectLanguage(filePath: string): FileLanguage {
  const provider = LanguageRegistry.getInstance().detectProvider(filePath);
  return provider.id as FileLanguage;
}

/**
 * Returns CodeMirror 6 extensions configured for the specified language.
 */
export function getLanguageExtensions(language: FileLanguage, readOnly = false): Extension[] {
  const extensions: Extension[] = [manifestSyntaxHighlighting];
  const provider = LanguageRegistry.getInstance().getProvider(language);

  if (provider && provider.getExtensions) {
    extensions.push(...provider.getExtensions(readOnly));
  }

  return extensions;
}
