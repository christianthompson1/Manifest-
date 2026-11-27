import { SemanticDiagnostic } from '../semantics/types.ts';
import {
  calculateAccountSpace,
  normalizeSolanaType,
  SolanaAccountIR,
  SolanaCpiIR,
  SolanaErrorIR,
  SolanaEventFieldIR,
  SolanaEventIR,
  SolanaFieldIR,
  SolanaInstructionArgIR,
  SolanaInstructionContextField,
  SolanaInstructionIR,
  SolanaMutationIR,
  SolanaPdaSeed,
  SolanaProgramIR,
} from './solana-ir.ts';

export interface SolanaProgramParseResult {
  ok: boolean;
  program?: SolanaProgramIR;
  diagnostics: SemanticDiagnostic[];
}

const DEFAULT_PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

function stripInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
    } else if (!inSingle && !inDouble) {
      if ((ch === '/' && line[i + 1] === '/') || (ch === '-' && line[i + 1] === '-') || ch === '#') {
        return line.slice(0, i).trimEnd();
      }
    }
  }
  return line;
}

function stripAllCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/--.*$/gm, '')
    .replace(/#.*$/gm, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/**
 * Returns true if the source file defines a standalone Manifest Solana smart-contract
 * (`PROGRAM <Name> ... END`) without general-purpose `module` / `MODULE` headers or removed v0.x constructs.
 */
export function isSolanaProgramSource(source: string): boolean {
  const stripped = stripAllCommentsAndStrings(source);
  if (/^\s*module\s+[a-zA-Z0-9_.]+\s*;/m.test(stripped)) {
    return false;
  }
  if (/^\s*MODULE\s+[a-zA-Z0-9_.]+/m.test(stripped)) {
    return false;
  }
  if (/^\s*(?:APP|PAGE|COMPONENT|SERVER|ENDPOINT|ROUTE|STYLE|STATE|ACTION)\b/m.test(stripped)) {
    return false;
  }
  return /^\s*PROGRAM\s+[A-Za-z_][A-Za-z0-9_]*/m.test(stripped);
}

function findLegacyV0Line(lines: string[]): { keyword: string; line: number } | null {
  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = stripInlineComment(lines[idx]).trim();
    if (!trimmed) continue;
    const match = trimmed.match(
      /^(APP|PAGE|COMPONENT|STATE|ACTION|DEFINE|SERVER|ENDPOINT|ROUTE|STYLE|CSS|JS|USE\s+SOLANA|USE\s+WEB)\b/
    );
    if (match) {
      return { keyword: match[1], line: idx + 1 };
    }
    if (/^WHEN\s+(?:app\.starts|CLICK|SUBMIT|CHANGE)\b/i.test(trimmed)) {
      return { keyword: 'WHEN', line: idx + 1 };
    }
  }
  return null;
}

function parsePdaSeeds(raw: string): SolanaPdaSeed[] {
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      if ((seg.startsWith('"') && seg.endsWith('"')) || (seg.startsWith("'") && seg.endsWith("'"))) {
        return { kind: 'literal', value: seg.slice(1, -1) };
      }
      if (seg.startsWith('arg:')) {
        return { kind: 'arg', value: seg.slice(4).trim() };
      }
      return { kind: 'account', value: seg };
    });
}

function parseExpressionRightSide(raw: string): Pick<SolanaMutationIR, 'operation' | 'operand'> {
  const expr = raw.trim();
  const addMatch = expr.match(/^(.+?)\s*\+\s*(.+)$/);
  if (addMatch) return { operation: 'checked_add', operand: addMatch[2].trim() };
  const subMatch = expr.match(/^(.+?)\s*-\s*(.+)$/);
  if (subMatch) return { operation: 'checked_sub', operand: subMatch[2].trim() };
  const mulMatch = expr.match(/^(.+?)\s*\*\s*(.+)$/);
  if (mulMatch) return { operation: 'checked_mul', operand: mulMatch[2].trim() };
  return { operation: 'assign' };
}

/**
 * Parses standalone canonical Manifest Solana smart-contract source (`PROGRAM <Name> ... END`)
 * directly into `SolanaProgramIR` without legacy v0.x AST/IRBuilder coupling.
 */
export function parseSolanaProgramSource(source: string): SolanaProgramParseResult {
  const diagnostics: SemanticDiagnostic[] = [];
  const rawLines = source.split(/\r?\n/);

  const legacyHit = findLegacyV0Line(rawLines);
  if (legacyHit) {
    diagnostics.push({
      code: 'E_LEGACY_V0_REMOVED',
      severity: 'error',
      message: `Legacy Manifest v0.x construct '${legacyHit.keyword}' was removed in Manifest v1.0. Standalone Solana contracts begin directly with 'PROGRAM <Name>'.`,
      line: legacyHit.line,
      column: 1,
      hint: "Run 'manifest migrate <file>' or remove legacy 'APP' / 'USE SOLANA' headers so the file begins directly with 'PROGRAM <Name>'.",
    });
    return { ok: false, diagnostics };
  }

  let programName = '';
  let programId = DEFAULT_PROGRAM_ID;
  const accounts: SolanaAccountIR[] = [];
  const instructions: SolanaInstructionIR[] = [];
  const events: SolanaEventIR[] = [];
  const errors: SolanaErrorIR[] = [];
  let rawRustEscape: string | undefined;

  let i = 0;
  let inBlockComment = false;

  const nextCleanLine = (lineText: string): string => {
    let text = lineText;
    if (inBlockComment) {
      const endIdx = text.indexOf('*/');
      if (endIdx === -1) return '';
      text = text.slice(endIdx + 2);
      inBlockComment = false;
    }
    while (true) {
      const startIdx = text.indexOf('/*');
      if (startIdx === -1) break;
      const endIdx = text.indexOf('*/', startIdx + 2);
      if (endIdx === -1) {
        text = text.slice(0, startIdx);
        inBlockComment = true;
        break;
      }
      text = text.slice(0, startIdx) + ' ' + text.slice(endIdx + 2);
    }
    return stripInlineComment(text).trim();
  };

  let insideProgram = false;

  while (i < rawLines.length) {
    const lineNum = i + 1;
    const line = nextCleanLine(rawLines[i]);
    i++;
    if (!line) continue;

    if (!insideProgram) {
      if (line === '[solana]' || line.startsWith('PROFILE ')) {
        continue;
      }
      const idMatch = line.match(/^(?:PROGRAM_ID|program_id)\s*=?\s*"([^"]+)"$/i);
      if (idMatch) {
        programId = idMatch[1];
        continue;
      }
      const progMatch = line.match(/^PROGRAM\s+([A-Za-z_][A-Za-z0-9_]*)$/);
      if (progMatch) {
        programName = progMatch[1];
        insideProgram = true;
        continue;
      }
      diagnostics.push({
        code: 'E_SOLANA_SYNTAX',
        severity: 'error',
        message: `Expected 'PROGRAM <Name>' block in Solana contract source, found '${line}'.`,
        line: lineNum,
        column: 1,
      });
      continue;
    }

    if (line === 'END') {
      insideProgram = false;
      continue;
    }

    const idInsideMatch = line.match(/^(?:PROGRAM_ID|program_id)\s*=?\s*"([^"]+)"$/i);
    if (idInsideMatch) {
      programId = idInsideMatch[1];
      continue;
    }

    if (line === 'RUST') {
      const rustLines: string[] = [];
      let closed = false;
      while (i < rawLines.length) {
        const rawL = rawLines[i];
        i++;
        if (rawL.trim() === 'END') {
          closed = true;
          break;
        }
        rustLines.push(rawL);
      }
      if (!closed) {
        diagnostics.push({
          code: 'E_SOLANA_SYNTAX',
          severity: 'error',
          message: `Unterminated 'RUST' block inside PROGRAM '${programName}'. Expected 'END'.`,
          line: lineNum,
          column: 1,
        });
      }
      rawRustEscape = rustLines.join('\n');
      continue;
    }

    const errMatch = line.match(/^ERROR\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(\d+))?\s*:?\s*"([^"]*)"$/);
    if (errMatch) {
      errors.push({
        name: errMatch[1],
        code: errMatch[2] ? Number(errMatch[2]) : 6004 + errors.length,
        msg: errMatch[3],
        sourceLine: lineNum,
        sourceColumn: 1,
      });
      continue;
    }

    const evMatch = line.match(/^EVENT\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (evMatch) {
      const evName = evMatch[1];
      const fields: SolanaEventFieldIR[] = [];
      let closed = false;
      while (i < rawLines.length) {
        const subNum = i + 1;
        const sub = nextCleanLine(rawLines[i]);
        i++;
        if (!sub) continue;
        if (sub === 'END') {
          closed = true;
          break;
        }
        const fMatch = sub.match(/^(?:FIELD\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/);
        if (!fMatch) {
          diagnostics.push({
            code: 'E_SOLANA_SYNTAX',
            severity: 'error',
            message: `Invalid EVENT field '${sub}'. Expected '<name>: <Type>'.`,
            line: subNum,
            column: 1,
          });
          continue;
        }
        try {
          fields.push({ name: fMatch[1], fieldType: normalizeSolanaType(fMatch[2]) });
        } catch (err: any) {
          diagnostics.push({
            code: 'E_SOLANA_TYPE',
            severity: 'error',
            message: err.message,
            line: subNum,
            column: 1,
          });
        }
      }
      if (!closed) {
        diagnostics.push({
          code: 'E_SOLANA_SYNTAX',
          severity: 'error',
          message: `Unterminated EVENT '${evName}'. Expected 'END'.`,
          line: lineNum,
          column: 1,
        });
      }
      events.push({ name: evName, fields });
      continue;
    }

    const accMatch = line.match(/^ACCOUNT\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(PDA))?$/);
    if (accMatch) {
      const accName = accMatch[1];
      const fields: SolanaFieldIR[] = [];
      let isPda = Boolean(accMatch[2]);
      let pdaSeeds: SolanaPdaSeed[] | undefined;
      let pdaBump: string | undefined;
      let closed = false;

      while (i < rawLines.length) {
        const subNum = i + 1;
        const sub = nextCleanLine(rawLines[i]);
        i++;
        if (!sub) continue;
        if (sub === 'END') {
          closed = true;
          break;
        }
        const seedsMatch = sub.match(/^(?:PDA\s+)?SEEDS\s*(\[[^\]]*\])(?:\s+BUMP\s+([A-Za-z_][A-Za-z0-9_]*))?$/i);
        if (seedsMatch) {
          isPda = true;
          pdaSeeds = parsePdaSeeds(seedsMatch[1]);
          if (seedsMatch[2]) pdaBump = seedsMatch[2];
          continue;
        }
        const fMatch = sub.match(/^(?:FIELD\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/);
        if (!fMatch) {
          diagnostics.push({
            code: 'E_SOLANA_SYNTAX',
            severity: 'error',
            message: `Invalid ACCOUNT field '${sub}'. Expected '<name>: <Type>'.`,
            line: subNum,
            column: 1,
          });
          continue;
        }
        try {
          fields.push({
            name: fMatch[1],
            fieldType: normalizeSolanaType(fMatch[2]),
            sourceLine: subNum,
            sourceColumn: 1,
          });
        } catch (err: any) {
          diagnostics.push({
            code: 'E_SOLANA_TYPE',
            severity: 'error',
            message: err.message,
            line: subNum,
            column: 1,
          });
        }
      }

      if (!closed) {
        diagnostics.push({
          code: 'E_SOLANA_SYNTAX',
          severity: 'error',
          message: `Unterminated ACCOUNT '${accName}'. Expected 'END'.`,
          line: lineNum,
          column: 1,
        });
      }

      accounts.push({
        name: accName,
        fields,
        spaceEstimate: calculateAccountSpace(fields),
        isPda: isPda || undefined,
        pda: pdaSeeds ? { seeds: pdaSeeds, bump: pdaBump } : undefined,
      });
      continue;
    }

    const instMatch = line.match(/^INSTRUCTION\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (instMatch) {
      const instName = instMatch[1];
      const explicitCtxAccounts: SolanaInstructionContextField[] = [];
      const args: SolanaInstructionArgIR[] = [];
      const requires: string[] = [];
      const mutations: SolanaMutationIR[] = [];
      const cpis: SolanaCpiIR[] = [];
      const instEvents: SolanaEventIR[] = [];
      let instRawRust: string | undefined;
      let closed = false;

      while (i < rawLines.length) {
        const subNum = i + 1;
        const sub = nextCleanLine(rawLines[i]);
        i++;
        if (!sub) continue;
        if (sub === 'END') {
          closed = true;
          break;
        }

        if (sub === 'RUST') {
          const rustLines: string[] = [];
          while (i < rawLines.length) {
            const rawL = rawLines[i];
            i++;
            if (rawL.trim() === 'END') break;
            rustLines.push(rawL);
          }
          instRawRust = rustLines.join('\n');
          continue;
        }

        const argMatch = sub.match(/^(?:ARG|PARAM)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/);
        if (argMatch) {
          try {
            args.push({ name: argMatch[1], argType: normalizeSolanaType(argMatch[2]) });
          } catch (err: any) {
            diagnostics.push({ code: 'E_SOLANA_TYPE', severity: 'error', message: err.message, line: subNum, column: 1 });
          }
          continue;
        }

        const ctxAccMatch = sub.match(
          /^ACCOUNT\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?(.*)$/
        );
        if (ctxAccMatch) {
          const accVar = ctxAccMatch[1];
          const accType = ctxAccMatch[2];
          const flagsStr = (ctxAccMatch[3] || '').toUpperCase();
          const isInit = /\bINIT\b/.test(flagsStr);
          const isMut = isInit || /\bMUT\b/.test(flagsStr);
          const isSigner = /\bSIGNER\b/.test(flagsStr);
          const payerMatch = ctxAccMatch[3]?.match(/\bPAYER\s+([A-Za-z_][A-Za-z0-9_]*)/i);
          const matchingSchema = accType ? accounts.find((a) => a.name === accType) : undefined;
          explicitCtxAccounts.push({
            name: accVar,
            isMut,
            isSigner,
            accountType: accType,
            pda: matchingSchema?.pda,
            constraints: isInit
              ? { init: true, payer: payerMatch ? payerMatch[1] : 'authority', mut: true }
              : undefined,
          });
          continue;
        }

        const reqMatch = sub.match(/^REQUIRE\s+(.+)$/);
        if (reqMatch) {
          requires.push(reqMatch[1].trim());
          continue;
        }

        const setMatch = sub.match(/^(?:SET|MUTATE)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=|TO)\s*(.+)$/);
        if (setMatch) {
          const target = setMatch[1].trim();
          const expression = setMatch[2].trim();
          const math = parseExpressionRightSide(expression);
          mutations.push({
            target,
            expression,
            operation: math.operation,
            operand: math.operand,
          });
          continue;
        }

        const cpiColonMatch = sub.match(/^CPI\s+([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?$/);
        if (cpiColonMatch) {
          cpis.push({
            targetProgram: cpiColonMatch[1],
            instructionName: cpiColonMatch[2],
            params: cpiColonMatch[3] ? { amount: cpiColonMatch[3].trim() } : {},
          });
          continue;
        }

        const cpiSpaceMatch = sub.match(/^CPI\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+amount=(.+))?$/);
        if (cpiSpaceMatch) {
          cpis.push({
            targetProgram: cpiSpaceMatch[1],
            instructionName: cpiSpaceMatch[2],
            params: cpiSpaceMatch[3] ? { amount: cpiSpaceMatch[3].trim() } : {},
          });
          continue;
        }

        const emitMatch = sub.match(/^EMIT\s+([A-Za-z_][A-Za-z0-9_]*)$/);
        if (emitMatch) {
          const evDef = events.find((e) => e.name === emitMatch[1]);
          if (evDef) {
            instEvents.push(evDef);
          } else {
            diagnostics.push({
              code: 'E_SOLANA_UNKNOWN_EVENT',
              severity: 'error',
              message: `Unknown event '${emitMatch[1]}' in instruction '${instName}'. Declare 'EVENT ${emitMatch[1]} ... END' first.`,
              line: subNum,
              column: 1,
            });
          }
          continue;
        }

        diagnostics.push({
          code: 'E_SOLANA_SYNTAX',
          severity: 'error',
          message: `Unrecognized statement in INSTRUCTION '${instName}': '${sub}'.`,
          line: subNum,
          column: 1,
        });
      }

      if (!closed) {
        diagnostics.push({
          code: 'E_SOLANA_SYNTAX',
          severity: 'error',
          message: `Unterminated INSTRUCTION '${instName}'. Expected 'END'.`,
          line: lineNum,
          column: 1,
        });
      }

      const ctxAccounts: SolanaInstructionContextField[] =
        explicitCtxAccounts.length > 0
          ? explicitCtxAccounts
          : [
              ...accounts.map((acc) => ({
                name: acc.name.toLowerCase().replace(/state$/i, '') || 'state',
                isMut: true,
                isSigner: false,
                accountType: acc.name,
                pda: acc.pda,
              })),
              {
                name: 'authority',
                isMut: true,
                isSigner: true,
              },
            ];

      instructions.push({
        name: instName,
        accounts: ctxAccounts,
        args: args.length > 0 ? args : undefined,
        requires,
        mutations,
        cpis,
        events: instEvents.length > 0 ? instEvents : undefined,
        rawRust: instRawRust,
      });
      continue;
    }

    diagnostics.push({
      code: 'E_SOLANA_SYNTAX',
      severity: 'error',
      message: `Unexpected construct inside PROGRAM '${programName}': '${line}'. Expected ACCOUNT, INSTRUCTION, EVENT, ERROR, RUST, or END.`,
      line: lineNum,
      column: 1,
    });
  }

  if (insideProgram) {
    diagnostics.push({
      code: 'E_SOLANA_SYNTAX',
      severity: 'error',
      message: `Unterminated PROGRAM '${programName}'. Expected closing 'END'.`,
      line: rawLines.length,
      column: 1,
    });
  }

  if (!programName && !diagnostics.some((d) => d.severity === 'error')) {
    diagnostics.push({
      code: 'E_SOLANA_CONTRACT_REQUIRED',
      severity: 'error',
      message: `Solana contract source must declare a 'PROGRAM <Name> ... END' block.`,
      line: 1,
      column: 1,
    });
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    program: {
      programName,
      programId,
      accounts,
      instructions,
      errors: errors.length > 0 ? errors : undefined,
      events: events.length > 0 ? events : undefined,
      rawRustEscape,
    },
    diagnostics,
  };
}
