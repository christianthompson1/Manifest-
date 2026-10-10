import fs from 'fs';
import { Lexer } from './lexer/lexer.ts';
import { Parser } from './parser/parser.ts';
import { Validator } from './validator/validator.ts';
import { Runtime } from './runtime/runtime.ts';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx manifest-core/src/cli.ts <file.manifest>');
    process.exit(1);
  }

  const content = fs.readFileSync(file, 'utf-8');
  const lexer = new Lexer(content);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const validator = new Validator();
  const validation = validator.validate(ast);

  if (!validation.isValid) {
    console.error('Validation errors:', validation.issues);
    process.exit(1);
  }

  const runtime = new Runtime();
  await runtime.execute(ast);
  console.log('Execution finished successfully. Logs:');
  console.log(runtime.getLogs().join('\n'));
}

main().catch(console.error);
