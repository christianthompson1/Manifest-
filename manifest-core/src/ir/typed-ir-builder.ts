import {
  FnDecl,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  SourceSpan,
} from '../core/ast-v2.ts';
import { CapabilityAuditReport } from '../semantics/capability-analyzer.ts';
import { TypeCheckResult } from '../semantics/type-checker.ts';
import {
  lookupStdIntrinsic,
  SemanticType,
  T_ANY,
  T_BOOL,
  T_F64,
  T_I64,
  T_STR,
  T_VOID,
} from '../semantics/types.ts';
import {
  MIREnum,
  MIRExpr,
  MIRFunction,
  MIRGlobal,
  MIRLocal,
  MIRMatchArm,
  MIRModule,
  MIRStmt,
  MIRStruct,
} from './typed-ir.ts';

interface LocalScopeBinding {
  name: string;
  slot: number;
  type: SemanticType;
  mutable: boolean;
}

class FunctionLoweringContext {
  public locals: MIRLocal[] = [];
  private scopes: Array<Map<string, LocalScopeBinding>> = [new Map()];
  private synthCounter = 0;

  constructor(
    public readonly fnName: string,
    public readonly returnType: SemanticType,
    private readonly globalsByName: Map<string, MIRGlobal>,
    private readonly structsByName: Map<string, MIRStruct>,
    private readonly enumsByName: Map<string, MIREnum>,
    private readonly fnReturnTypes: Map<string, SemanticType>,
    private readonly exprTypes: WeakMap<SemanticExpr, SemanticType>,
    public readonly diagnostics: any[] = []
  ) {}

  public pushScope(): void {
    this.scopes.push(new Map());
  }

  public popScope(): void {
    this.scopes.pop();
  }

  public allocLocal(
    name: string,
    type: SemanticType,
    mutable: boolean,
    isParam: boolean,
    span: SourceSpan,
    registerInScope = true
  ): number {
    const slot = this.locals.length;
    this.locals.push({
      name,
      slot,
      isParam,
      mutable,
      type,
      span,
    });
    if (registerInScope) {
      this.scopes[this.scopes.length - 1].set(name, { name, slot, type, mutable });
    }
    return slot;
  }

  public allocTemp(prefix: string, type: SemanticType, span: SourceSpan): MIRLocal {
    const name = `__${prefix}_${this.synthCounter++}`;
    const slot = this.allocLocal(name, type, true, false, span, false);
    return this.locals[slot];
  }

  public lookupLocal(name: string): LocalScopeBinding | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i].get(name);
      if (found) return found;
    }
    return undefined;
  }

  public lookupGlobal(name: string): MIRGlobal | undefined {
    return this.globalsByName.get(name);
  }

  public exprType(expr: SemanticExpr): SemanticType {
    return this.exprTypes.get(expr) || T_ANY;
  }

  public lowerBlock(stmts: SemanticStmt[]): MIRStmt[] {
    const out: MIRStmt[] = [];
    for (const s of stmts) {
      this.lowerStmtInto(s, out);
    }
    return out;
  }

  public lowerStmtInto(stmt: SemanticStmt, out: MIRStmt[]): void {
    switch (stmt.kind) {
      case 'VarStmt': {
        const val = this.lowerExpr(stmt.decl.init);
        if (this.fnName === '__script__' && this.scopes.length === 1) {
          const glob = this.lookupGlobal(stmt.decl.name);
          if (glob) {
            out.push({
              kind: 'StoreGlobal',
              slot: glob.slot,
              name: glob.name,
              value: val,
              span: stmt.span,
            });
            break;
          }
        }
        const slot = this.allocLocal(
          stmt.decl.name,
          val.type,
          stmt.decl.mutable,
          false,
          stmt.span,
          true
        );
        out.push({
          kind: 'StoreLocal',
          slot,
          name: stmt.decl.name,
          isDeclaration: true,
          value: val,
          span: stmt.span,
        });
        break;
      }

      case 'ConstStmt': {
        const val = this.lowerExpr(stmt.decl.init);
        const slot = this.allocLocal(stmt.decl.name, val.type, false, false, stmt.span, true);
        out.push({
          kind: 'StoreLocal',
          slot,
          name: stmt.decl.name,
          isDeclaration: true,
          value: val,
          span: stmt.span,
        });
        break;
      }

      case 'AssignStmt': {
        const val = this.lowerExpr(stmt.value);
        if (stmt.target.kind === 'VarTarget') {
          const loc = this.lookupLocal(stmt.target.name);
          if (loc) {
            out.push({
              kind: 'StoreLocal',
              slot: loc.slot,
              name: loc.name,
              isDeclaration: false,
              value: val,
              span: stmt.span,
            });
            break;
          }
          const glob = this.lookupGlobal(stmt.target.name);
          if (glob) {
            out.push({
              kind: 'StoreGlobal',
              slot: glob.slot,
              name: glob.name,
              value: val,
              span: stmt.span,
            });
            break;
          }
          // Legacy implicit local fallback
          const newSlot = this.allocLocal(stmt.target.name, val.type, true, false, stmt.span, true);
          out.push({
            kind: 'StoreLocal',
            slot: newSlot,
            name: stmt.target.name,
            isDeclaration: true,
            value: val,
            span: stmt.span,
          });
        } else if (stmt.target.kind === 'FieldTarget') {
          const fieldTarget = stmt.target;
          const obj = this.lowerExpr(fieldTarget.object);
          const stName = obj.type.kind === 'struct' ? obj.type.name : '';
          const st = this.structsByName.get(stName);
          const fIdx = st ? st.fields.findIndex((f) => f.name === fieldTarget.field) : 0;
          out.push({
            kind: 'FieldSet',
            object: obj,
            structName: stName,
            fieldName: fieldTarget.field,
            fieldIndex: Math.max(0, fIdx),
            value: val,
            span: stmt.span,
          });
        } else if (stmt.target.kind === 'IndexTarget') {
          const obj = this.lowerExpr(stmt.target.object);
          const idx = this.lowerExpr(stmt.target.index);
          if (obj.type.kind === 'map') {
            out.push({
              kind: 'MapSetStmt',
              map: obj,
              key: idx,
              value: val,
              span: stmt.span,
            });
          } else {
            out.push({
              kind: 'ArraySet',
              array: obj,
              index: idx,
              value: val,
              span: stmt.span,
            });
          }
        }
        break;
      }

      case 'ExprStmt': {
        out.push({
          kind: 'ExprStmt',
          expr: this.lowerExpr(stmt.expr),
          span: stmt.span,
        });
        break;
      }

      case 'IfStmt': {
        const cond = this.lowerExpr(stmt.condition);
        this.pushScope();
        const thenBranch = this.lowerBlock(stmt.thenBranch);
        this.popScope();

        this.pushScope();
        const elseBranch = this.lowerBlock(stmt.elseBranch);
        this.popScope();

        out.push({
          kind: 'If',
          condition: cond,
          thenBranch,
          elseBranch,
          span: stmt.span,
        });
        break;
      }

      case 'WhileStmt': {
        const cond = this.lowerExpr(stmt.condition);
        this.pushScope();
        const body = this.lowerBlock(stmt.body);
        this.popScope();
        out.push({
          kind: 'While',
          condition: cond,
          body,
          span: stmt.span,
        });
        break;
      }

      case 'RepeatStmt': {
        // Desugar `repeat N { body }` into deterministic counted while-loop
        // Note: To handle `continue` properly, increment counter before body check or at end.
        // Using pre-increment (`i = -1; while ({ i = i + 1; i < limit })`) ensures `continue` always advances!
        const limitExpr = this.lowerExpr(stmt.count);
        const limitTemp = this.allocTemp('repeat_limit', T_I64, stmt.span);
        const idxTemp = this.allocTemp('repeat_idx', T_I64, stmt.span);

        out.push({
          kind: 'StoreLocal',
          slot: limitTemp.slot,
          name: limitTemp.name,
          isDeclaration: true,
          value: limitExpr,
          span: stmt.span,
        });
        out.push({
          kind: 'StoreLocal',
          slot: idxTemp.slot,
          name: idxTemp.name,
          isDeclaration: true,
          value: { kind: 'ConstInt', value: 0n, type: T_I64, span: stmt.span },
          span: stmt.span,
        });

        this.pushScope();
        const rawBody = this.lowerBlock(stmt.body);
        this.popScope();

        const incStmt: MIRStmt = {
          kind: 'StoreLocal',
          slot: idxTemp.slot,
          name: idxTemp.name,
          isDeclaration: false,
          value: {
            kind: 'Binary',
            op: '+',
            left: {
              kind: 'LoadLocal',
              slot: idxTemp.slot,
              name: idxTemp.name,
              type: T_I64,
              span: stmt.span,
            },
            right: { kind: 'ConstInt', value: 1n, type: T_I64, span: stmt.span },
            type: T_I64,
            span: stmt.span,
          },
          span: stmt.span,
        };

        const patchedBody = injectBeforeContinue(rawBody, incStmt);
        patchedBody.push(incStmt);

        out.push({
          kind: 'While',
          condition: {
            kind: 'Binary',
            op: '<',
            left: {
              kind: 'LoadLocal',
              slot: idxTemp.slot,
              name: idxTemp.name,
              type: T_I64,
              span: stmt.span,
            },
            right: {
              kind: 'LoadLocal',
              slot: limitTemp.slot,
              name: limitTemp.name,
              type: T_I64,
              span: stmt.span,
            },
            type: T_BOOL,
            span: stmt.span,
          },
          body: patchedBody,
          span: stmt.span,
        });
        break;
      }

      case 'ForInStmt': {
        // Desugar `for item in iterable { body }` into indexed array iteration
        const iterExpr = this.lowerExpr(stmt.iterable);
        const elemType = iterExpr.type.kind === 'array' ? iterExpr.type.element : T_ANY;
        const arrTemp = this.allocTemp('for_arr', iterExpr.type, stmt.span);
        const idxTemp = this.allocTemp('for_idx', T_I64, stmt.span);

        out.push({
          kind: 'StoreLocal',
          slot: arrTemp.slot,
          name: arrTemp.name,
          isDeclaration: true,
          value: iterExpr,
          span: stmt.span,
        });
        out.push({
          kind: 'StoreLocal',
          slot: idxTemp.slot,
          name: idxTemp.name,
          isDeclaration: true,
          value: { kind: 'ConstInt', value: 0n, type: T_I64, span: stmt.span },
          span: stmt.span,
        });

        this.pushScope();
        const itemSlot = this.allocLocal(stmt.itemName, elemType, false, false, stmt.span, true);
        const bindItemStmt: MIRStmt = {
          kind: 'StoreLocal',
          slot: itemSlot,
          name: stmt.itemName,
          isDeclaration: true,
          value: {
            kind: 'ArrayGet',
            array: {
              kind: 'LoadLocal',
              slot: arrTemp.slot,
              name: arrTemp.name,
              type: iterExpr.type,
              span: stmt.span,
            },
            index: {
              kind: 'LoadLocal',
              slot: idxTemp.slot,
              name: idxTemp.name,
              type: T_I64,
              span: stmt.span,
            },
            type: elemType,
            span: stmt.span,
          },
          span: stmt.span,
        };
        const rawBody = this.lowerBlock(stmt.body);
        this.popScope();

        const incStmt: MIRStmt = {
          kind: 'StoreLocal',
          slot: idxTemp.slot,
          name: idxTemp.name,
          isDeclaration: false,
          value: {
            kind: 'Binary',
            op: '+',
            left: {
              kind: 'LoadLocal',
              slot: idxTemp.slot,
              name: idxTemp.name,
              type: T_I64,
              span: stmt.span,
            },
            right: { kind: 'ConstInt', value: 1n, type: T_I64, span: stmt.span },
            type: T_I64,
            span: stmt.span,
          },
          span: stmt.span,
        };

        const patchedBody = [bindItemStmt, ...injectBeforeContinue(rawBody, incStmt), incStmt];

        out.push({
          kind: 'While',
          condition: {
            kind: 'Binary',
            op: '<',
            left: {
              kind: 'LoadLocal',
              slot: idxTemp.slot,
              name: idxTemp.name,
              type: T_I64,
              span: stmt.span,
            },
            right: {
              kind: 'ArrayLen',
              target: {
                kind: 'LoadLocal',
                slot: arrTemp.slot,
                name: arrTemp.name,
                type: iterExpr.type,
                span: stmt.span,
              },
              type: T_I64,
              span: stmt.span,
            },
            type: T_BOOL,
            span: stmt.span,
          },
          body: patchedBody,
          span: stmt.span,
        });
        break;
      }

      case 'BreakStmt':
        out.push({ kind: 'Break', span: stmt.span });
        break;

      case 'ContinueStmt':
        out.push({ kind: 'Continue', span: stmt.span });
        break;

      case 'ReturnStmt':
        out.push({
          kind: 'Return',
          value: stmt.value ? this.lowerExpr(stmt.value) : undefined,
          span: stmt.span,
        });
        break;

      case 'MatchStmt': {
        const subject = this.lowerExpr(stmt.subject);
        const subjTemp = this.allocTemp('match_subj', subject.type, stmt.span);
        const arms: MIRMatchArm[] = [];

        for (const arm of stmt.arms) {
          this.pushScope();
          let mirPattern: MIRMatchArm['pattern'];

          if (arm.pattern.kind === 'WildcardPattern') {
            mirPattern = { kind: 'Wildcard' };
          } else if (arm.pattern.kind === 'LiteralPattern') {
            const v = arm.pattern.value;
            if (typeof v === 'number') {
              if (arm.pattern.isFloat) {
                mirPattern = { kind: 'Literal', value: v, litKind: 'f64' };
              } else {
                mirPattern = { kind: 'Literal', value: BigInt(Math.trunc(v)), litKind: 'i64' };
              }
            } else if (typeof v === 'boolean') {
              mirPattern = { kind: 'Literal', value: v, litKind: 'bool' };
            } else {
              mirPattern = { kind: 'Literal', value: v, litKind: 'str' };
            }
          } else {
            const pat = arm.pattern;
            const enumName =
              pat.enumName ||
              (subject.type.kind === 'enum'
                ? subject.type.name
                : subject.type.kind === 'result'
                  ? 'Result'
                  : 'Result');
            const en = this.enumsByName.get(enumName);
            const variant = en?.variants.find((x) => x.name === pat.variantName);
            const variantTag = variant ? variant.tag : pat.variantName === 'Err' ? 1 : 0;

            const bindingSlots: Array<{ slot: number; name: string }> = [];
            for (let i = 0; i < pat.bindings.length; i++) {
              const bName = pat.bindings[i];
              let payloadType: SemanticType = T_ANY;
              if (subject.type.kind === 'enum') {
                const sv = subject.type.variants.find((x) => x.name === pat.variantName);
                payloadType = sv?.payload[i] || T_ANY;
              } else if (subject.type.kind === 'result') {
                payloadType = pat.variantName === 'Ok' ? subject.type.ok : subject.type.err;
              }
              const bSlot = this.allocLocal(bName, payloadType, false, false, pat.span, true);
              bindingSlots.push({ slot: bSlot, name: bName });
            }

            mirPattern = {
              kind: 'EnumVariant',
              enumName,
              variantName: pat.variantName,
              variantTag,
              bindingSlots,
            };
          }

          const body = this.lowerBlock(arm.body);
          this.popScope();
          arms.push({ pattern: mirPattern, body, span: arm.span });
        }

        out.push({
          kind: 'Match',
          subject,
          tempSlot: subjTemp.slot,
          arms,
          span: stmt.span,
        });
        break;
      }

      case 'TryStmt': {
        // Honest diagnostic: TryStmt catchBody cannot be dropped silently.
        // Once MVM v1.1 exception unwinding table and Result-lowering are implemented,
        // this will lower to an explicit try_catch block.
        this.diagnostics.push({
          code: 'E_UNIMPLEMENTED_FEATURE',
          severity: 'error',
          message: `The 'try / catch' construct is not yet supported in the Manifest IR and MVM execution pipeline. Use Result<T, E> (Ok / Err) and 'match' pattern matching for explicit, deterministic error handling.`,
          line: stmt.span.line,
          column: stmt.span.column,
          hint: `Replace 'try { ... } catch' with a function returning 'Result<T, str>' and handle with 'match res { Ok(val) => ..., Err(err) => ... }'.`,
        });
        break;
      }
    }
  }

  public lowerExpr(expr: SemanticExpr): MIRExpr {
    const inferred = this.exprType(expr);
    switch (expr.kind) {
      case 'IntLiteral':
        return { kind: 'ConstInt', value: expr.value, type: T_I64, span: expr.span };
      case 'FloatLiteral':
        return { kind: 'ConstFloat', value: expr.value, type: T_F64, span: expr.span };
      case 'BoolLiteral':
        return { kind: 'ConstBool', value: expr.value, type: T_BOOL, span: expr.span };
      case 'StringLiteral':
        return { kind: 'ConstStr', value: expr.value, type: T_STR, span: expr.span };

      case 'Identifier': {
        const loc = this.lookupLocal(expr.name);
        if (loc) {
          return {
            kind: 'LoadLocal',
            slot: loc.slot,
            name: loc.name,
            type: loc.type,
            span: expr.span,
          };
        }
        const glob = this.lookupGlobal(expr.name);
        if (glob) {
          return {
            kind: 'LoadGlobal',
            slot: glob.slot,
            name: glob.name,
            type: glob.type,
            span: expr.span,
          };
        }
        return { kind: 'ConstVoid', type: T_VOID, span: expr.span };
      }

      case 'UnaryExpr': {
        const operand = this.lowerExpr(expr.operand);
        return {
          kind: 'Unary',
          op: expr.op,
          operand,
          type: inferred.kind === 'any' ? operand.type : inferred,
          span: expr.span,
        };
      }

      case 'BinaryExpr': {
        const left = this.lowerExpr(expr.left);
        const right = this.lowerExpr(expr.right);
        return {
          kind: 'Binary',
          op: expr.op,
          left,
          right,
          type: inferred,
          span: expr.span,
        };
      }

      case 'ArrayLiteral':
        return {
          kind: 'ArrayNew',
          elements: expr.elements.map((e) => this.lowerExpr(e)),
          type: inferred,
          span: expr.span,
        };

      case 'MapLiteral':
        return {
          kind: 'MapNew',
          entries: expr.entries.map((e) => ({
            key: this.lowerExpr(e.key),
            value: this.lowerExpr(e.value),
          })),
          type: inferred,
          span: expr.span,
        };

      case 'IndexAccessExpr': {
        const obj = this.lowerExpr(expr.object);
        const idx = this.lowerExpr(expr.index);
        if (obj.type.kind === 'map') {
          return {
            kind: 'MapGet',
            map: obj,
            key: idx,
            type: inferred,
            span: expr.span,
          };
        }
        return {
          kind: 'ArrayGet',
          array: obj,
          index: idx,
          type: inferred,
          span: expr.span,
        };
      }

      case 'FieldAccessExpr': {
        const obj = this.lowerExpr(expr.object);
        if (obj.type.kind === 'array' && expr.field === 'length') {
          return {
            kind: 'ArrayLen',
            target: obj,
            type: T_I64,
            span: expr.span,
          };
        }
        const stName = obj.type.kind === 'struct' ? obj.type.name : '';
        const st = this.structsByName.get(stName);
        const fIdx = st ? st.fields.findIndex((f) => f.name === expr.field) : 0;
        return {
          kind: 'FieldGet',
          object: obj,
          structName: stName,
          fieldName: expr.field,
          fieldIndex: Math.max(0, fIdx),
          type: inferred,
          span: expr.span,
        };
      }

      case 'StructLiteral': {
        const st = this.structsByName.get(expr.structName);
        if (!st) {
          return { kind: 'ConstVoid', type: T_VOID, span: expr.span };
        }
        const fieldMap = new Map<string, MIRExpr>();
        for (const f of expr.fields) {
          fieldMap.set(f.name, this.lowerExpr(f.value));
        }
        const orderedFields: MIRExpr[] = st.fields.map(
          (declF): MIRExpr =>
            fieldMap.get(declF.name) || { kind: 'ConstVoid', type: T_VOID, span: expr.span }
        );
        return {
          kind: 'StructNew',
          structName: st.name,
          structIndex: st.index,
          fields: orderedFields,
          type: inferred,
          span: expr.span,
        };
      }

      case 'EnumConstructExpr': {
        const en = this.enumsByName.get(expr.enumName);
        const variant = en?.variants.find((v) => v.name === expr.variantName);
        return {
          kind: 'EnumNew',
          enumName: expr.enumName,
          enumIndex: en ? en.index : 0,
          variantName: expr.variantName,
          variantTag: variant ? variant.tag : 0,
          args: expr.args.map((a) => this.lowerExpr(a)),
          type: inferred,
          span: expr.span,
        };
      }

      case 'CallExpr': {
        const args = expr.args.map((a) => this.lowerExpr(a));

        // Direct VM instruction intrinsics
        if ((expr.callee === 'push' || expr.callee === 'array.push') && args.length === 2) {
          return {
            kind: 'ArrayPush',
            array: args[0],
            value: args[1],
            type: T_VOID,
            span: expr.span,
          };
        }
        if ((expr.callee === 'has' || expr.callee === 'map.has') && args.length === 2) {
          return {
            kind: 'MapHas',
            map: args[0],
            key: args[1],
            type: T_BOOL,
            span: expr.span,
          };
        }
        if (
          (expr.callee === 'len' || expr.callee === 'str.len' || expr.callee === 'std::str::len') &&
          args.length === 1
        ) {
          return {
            kind: 'ArrayLen',
            target: args[0],
            type: T_I64,
            span: expr.span,
          };
        }
        if ((expr.callee === 'to_str' || expr.callee === 'std::conv::to_str') && args.length === 1) {
          return {
            kind: 'Cast',
            castKind: 'to_str',
            operand: args[0],
            type: T_STR,
            span: expr.span,
          };
        }
        if ((expr.callee === 'to_f64' || expr.callee === 'std::conv::to_f64') && args.length === 1) {
          return {
            kind: 'Cast',
            castKind: 'i64_to_f64',
            operand: args[0],
            type: T_F64,
            span: expr.span,
          };
        }
        if ((expr.callee === 'to_i64' || expr.callee === 'std::conv::to_i64') && args.length === 1) {
          return {
            kind: 'Cast',
            castKind: 'f64_to_i64',
            operand: args[0],
            type: T_I64,
            span: expr.span,
          };
        }

        // Result<T, E> constructors
        if (expr.callee === 'Ok' && args.length === 1) {
          const resEnum = this.enumsByName.get('Result')!;
          return {
            kind: 'EnumNew',
            enumName: 'Result',
            enumIndex: resEnum.index,
            variantName: 'Ok',
            variantTag: 0,
            args,
            type: inferred,
            span: expr.span,
          };
        }
        if (expr.callee === 'Err' && args.length === 1) {
          const resEnum = this.enumsByName.get('Result')!;
          return {
            kind: 'EnumNew',
            enumName: 'Result',
            enumIndex: resEnum.index,
            variantName: 'Err',
            variantTag: 1,
            args,
            type: inferred,
            span: expr.span,
          };
        }

        const std = lookupStdIntrinsic(expr.callee);
        if (std) {
          return {
            kind: 'CallIntrinsic',
            symbol: std.symbol,
            capability: std.capability,
            args,
            type: std.returnType,
            span: expr.span,
          };
        }

        const retType = this.fnReturnTypes.get(expr.callee) || inferred;
        return {
          kind: 'CallFunction',
          callee: expr.callee,
          args,
          type: retType,
          span: expr.span,
        };
      }

      case 'AwaitExpr':
        return this.lowerExpr(expr.operand);

      case 'TryPropagateExpr':
        return {
          kind: 'TryPropagate',
          operand: this.lowerExpr(expr.operand),
          type: inferred,
          span: expr.span,
        };
    }
  }
}

function injectBeforeContinue(stmts: MIRStmt[], incStmt: MIRStmt): MIRStmt[] {
  const out: MIRStmt[] = [];
  for (const s of stmts) {
    if (s.kind === 'Continue') {
      out.push(incStmt);
      out.push(s);
    } else if (s.kind === 'If') {
      out.push({
        ...s,
        thenBranch: injectBeforeContinue(s.thenBranch, incStmt),
        elseBranch: injectBeforeContinue(s.elseBranch, incStmt),
      });
    } else if (s.kind === 'Match') {
      out.push({
        ...s,
        arms: s.arms.map((a) => ({
          ...a,
          body: injectBeforeContinue(a.body, incStmt),
        })),
      });
    } else {
      // Do NOT rewrite `continue` inside nested `While` loops!
      out.push(s);
    }
  }
  return out;
}

function stmtsContainCallToMain(stmts: SemanticStmt[]): boolean {
  for (const s of stmts) {
    if (s.kind === 'ExprStmt' && s.expr.kind === 'CallExpr' && s.expr.callee === 'main') {
      return true;
    }
    if (s.kind === 'VarStmt' && s.decl.init.kind === 'CallExpr' && s.decl.init.callee === 'main') {
      return true;
    }
  }
  return false;
}

export function buildTypedIR(
  module: SemanticModule,
  typeCheck: TypeCheckResult,
  capabilityAudit: CapabilityAuditReport
): MIRModule {
  const structs: MIRStruct[] = [];
  const structsByName = new Map<string, MIRStruct>();

  for (const st of module.structs) {
    const sem = typeCheck.structs.get(st.name);
    const fields =
      sem && sem.kind === 'struct'
        ? sem.fields.map((f, idx) => ({ name: f.name, index: idx, type: f.type }))
        : st.fields.map((f, idx) => ({ name: f.name, index: idx, type: T_ANY }));
    const mirSt: MIRStruct = {
      name: st.name,
      index: structs.length,
      exported: st.exported,
      fields,
    };
    structs.push(mirSt);
    structsByName.set(st.name, mirSt);
  }

  const enums: MIREnum[] = [];
  const enumsByName = new Map<string, MIREnum>();

  // Always register built-in Result<T, E> enum at index 0
  const resultEnum: MIREnum = {
    name: 'Result',
    index: 0,
    exported: false,
    variants: [
      { name: 'Ok', tag: 0, payloadTypes: [T_ANY] },
      { name: 'Err', tag: 1, payloadTypes: [T_ANY] },
    ],
  };
  enums.push(resultEnum);
  enumsByName.set('Result', resultEnum);

  for (const en of module.enums) {
    if (en.name === 'Result') continue;
    const sem = typeCheck.enums.get(en.name);
    const variants =
      sem && sem.kind === 'enum'
        ? sem.variants.map((v) => ({ name: v.name, tag: v.tag, payloadTypes: v.payload }))
        : en.variants.map((v, idx) => ({
            name: v.name,
            tag: idx,
            payloadTypes: v.payloadTypes.map(() => T_ANY),
          }));
    const mirEn: MIREnum = {
      name: en.name,
      index: enums.length,
      exported: en.exported,
      variants,
    };
    enums.push(mirEn);
    enumsByName.set(en.name, mirEn);
  }

  const fnReturnTypes = new Map<string, SemanticType>();
  for (const [name, sig] of typeCheck.functions.entries()) {
    fnReturnTypes.set(name, sig.returnType);
  }

  const fnEffectsMap = new Map<string, string[]>();
  for (const fa of capabilityAudit.functions) {
    fnEffectsMap.set(fa.name, fa.inferredEffects);
  }

  // Lower module-level constants & globals
  const globals: MIRGlobal[] = [];
  const globalsByName = new Map<string, MIRGlobal>();

  const initCtx = new FunctionLoweringContext(
    '__init__',
    T_VOID,
    globalsByName,
    structsByName,
    enumsByName,
    fnReturnTypes,
    typeCheck.exprTypes
  );

  const initBody: MIRStmt[] = [];

  for (const c of module.constants) {
    const initExpr = initCtx.lowerExpr(c.init);
    const slot = globals.length;
    const g: MIRGlobal = {
      name: c.name,
      slot,
      mutable: false,
      isConst: true,
      exported: c.exported,
      type: initExpr.type,
      init: initExpr,
      span: c.span,
    };
    globals.push(g);
    globalsByName.set(c.name, g);
    initBody.push({
      kind: 'StoreGlobal',
      slot,
      name: c.name,
      value: initExpr,
      span: c.span,
    });
  }

  for (const gv of module.globals) {
    const initExpr = initCtx.lowerExpr(gv.init);
    const slot = globals.length;
    const g: MIRGlobal = {
      name: gv.name,
      slot,
      mutable: gv.mutable,
      isConst: false,
      exported: gv.exported,
      type: initExpr.type,
      init: initExpr,
      span: gv.span,
    };
    globals.push(g);
    globalsByName.set(gv.name, g);
    const inTopLevel = module.topLevelStmts.some(
      (s) => s.kind === 'VarStmt' && s.decl.name === gv.name
    );
    if (!inTopLevel) {
      initBody.push({
        kind: 'StoreGlobal',
        slot,
        name: gv.name,
        value: initExpr,
        span: gv.span,
      });
    }
  }

  const functions: MIRFunction[] = [];
  const hasUserMain = module.functions.some((f) => f.name === 'main');
  const hasTopLevel = module.topLevelStmts.length > 0;
  const topCallsMain = hasTopLevel && stmtsContainCallToMain(module.topLevelStmts);

  if (initBody.length > 0) {
    initBody.push({ kind: 'Return', span: module.span });
    functions.push({
      name: '__init__',
      exported: false,
      isAsync: false,
      isEntry: false,
      isSynthetic: true,
      params: [],
      locals: initCtx.locals,
      returnType: T_VOID,
      effects: capabilityAudit.inferredModuleEffects,
      body: initBody,
      span: module.span,
    });
  }

  const lowerUserFunction = (fn: FnDecl, isEntry: boolean): MIRFunction => {
    const sig = typeCheck.functions.get(fn.name);
    const retType = sig ? sig.returnType : T_VOID;
    const ctx = new FunctionLoweringContext(
      fn.name,
      retType,
      globalsByName,
      structsByName,
      enumsByName,
      fnReturnTypes,
      typeCheck.exprTypes
    );

    const params: MIRLocal[] = [];
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const pType = sig?.params[i]?.type || T_ANY;
      const slot = ctx.allocLocal(p.name, pType, false, true, p.span, true);
      params.push(ctx.locals[slot]);
    }

    const body = ctx.lowerBlock(fn.body);
    ensureTrailingReturn(body, retType, fn.span);

    return {
      name: fn.name,
      exported: fn.exported || fn.name === 'main',
      isAsync: fn.isAsync,
      isEntry,
      isSynthetic: false,
      params,
      locals: ctx.locals,
      returnType: retType,
      effects: fnEffectsMap.get(fn.name) || [],
      body,
      span: fn.span,
    };
  };

  let entryFunction: string | undefined;

  for (const fn of module.functions) {
    const isEntry = fn.name === 'main' && (!hasTopLevel || !topCallsMain);
    if (isEntry) entryFunction = 'main';
    functions.push(lowerUserFunction(fn, isEntry));
  }

  if (hasTopLevel) {
    const scriptCtx = new FunctionLoweringContext(
      '__script__',
      T_ANY,
      globalsByName,
      structsByName,
      enumsByName,
      fnReturnTypes,
      typeCheck.exprTypes
    );
    const scriptBody = scriptCtx.lowerBlock(module.topLevelStmts);
    // If user also wrote `fn main` and didn't call it in top-level statements, call `main()` at the end of `__script__`
    if (hasUserMain && !topCallsMain) {
      const mainRet = fnReturnTypes.get('main') || T_VOID;
      if (mainRet.kind === 'void') {
        scriptBody.push({
          kind: 'ExprStmt',
          expr: {
            kind: 'CallFunction',
            callee: 'main',
            args: [],
            type: T_VOID,
            span: module.span,
          },
          span: module.span,
        });
        ensureTrailingReturn(scriptBody, T_VOID, module.span);
      } else {
        scriptBody.push({
          kind: 'Return',
          value: {
            kind: 'CallFunction',
            callee: 'main',
            args: [],
            type: mainRet,
            span: module.span,
          },
          span: module.span,
        });
      }
      // Mark `__script__` as the single entry point instead of `main`
      for (const f of functions) {
        if (f.name === 'main') f.isEntry = false;
      }
    } else {
      ensureTrailingReturn(scriptBody, T_VOID, module.span);
    }

    entryFunction = '__script__';
    functions.push({
      name: '__script__',
      exported: false,
      isAsync: false,
      isEntry: true,
      isSynthetic: true,
      params: [],
      locals: scriptCtx.locals,
      returnType: T_ANY,
      effects: capabilityAudit.inferredModuleEffects,
      body: scriptBody,
      span: module.span,
    });
  } else if (!entryFunction && functions.length === 0 && initBody.length > 0) {
    // Module with only constants/globals
    functions[0].isEntry = true;
    entryFunction = functions[0].name;
  }

  // Ensure module `requires` in MIR reflects either explicit `requires` or inferred non-denied effects
  // (after CapabilityAnalyzer has already validated policy compliance!)
  const explicitReqs = new Set(capabilityAudit.declaredRequires);
  for (const eff of capabilityAudit.inferredModuleEffects) {
    const denied = capabilityAudit.declaredDenies.some(
      (d) => eff === d || eff.startsWith(`${d}.`)
    );
    if (!denied) {
      explicitReqs.add(eff);
    }
  }

  return {
    kind: 'MIRModule',
    moduleName: module.moduleName,
    sourceProfile: module.profile,
    requires: Array.from(explicitReqs),
    provides: [...capabilityAudit.declaredProvides],
    denies: [...capabilityAudit.declaredDenies],
    structs,
    enums,
    globals,
    functions,
    entryFunction,
  };
}

function ensureTrailingReturn(body: MIRStmt[], returnType: SemanticType, span: SourceSpan): void {
  const last = body[body.length - 1];
  if (last && last.kind === 'Return') return;
  if (returnType.kind === 'void' || returnType.kind === 'any') {
    body.push({ kind: 'Return', span });
  }
}
