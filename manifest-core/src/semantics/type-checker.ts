import {
  AssignTarget,
  FnDecl,
  MatchPattern,
  SemanticExpr,
  SemanticModule,
  SemanticStmt,
  SourceSpan,
} from '../core/ast-v2.ts';
import {
  formatSemanticType,
  FunctionSignature,
  lookupStdIntrinsic,
  resolveTypeNode,
  SemanticDiagnostic,
  SemanticType,
  substituteTypeParams,
  T_ANY,
  T_BOOL,
  T_F64,
  T_I64,
  T_STR,
  T_VOID,
  typesCompatible,
} from './types.ts';

interface SymbolEntry {
  name: string;
  type: SemanticType;
  mutable: boolean;
  isConst: boolean;
  span: SourceSpan;
}

export interface TypeCheckResult {
  valid: boolean;
  diagnostics: SemanticDiagnostic[];
  structs: Map<string, SemanticType>;
  enums: Map<string, SemanticType>;
  functions: Map<string, FunctionSignature>;
  exprTypes: WeakMap<SemanticExpr, SemanticType>;
}

export class TypeChecker {
  private diagnostics: SemanticDiagnostic[] = [];
  private structs = new Map<string, SemanticType>();
  private enums = new Map<string, SemanticType>();
  private functions = new Map<string, FunctionSignature>();
  private exprTypes = new WeakMap<SemanticExpr, SemanticType>();
  private isLegacyApp = false;

  public check(module: SemanticModule): TypeCheckResult {
    this.diagnostics = [];
    this.structs.clear();
    this.enums.clear();
    this.functions.clear();
    this.isLegacyApp = module.isLegacyApp;

    // Built-in Result<T, E> enum template
    this.enums.set('Result', {
      kind: 'enum',
      name: 'Result',
      typeArgs: [
        { kind: 'type_param', name: 'T' },
        { kind: 'type_param', name: 'E' },
      ],
      variants: [
        { name: 'Ok', tag: 0, payload: [{ kind: 'type_param', name: 'T' }] },
        { name: 'Err', tag: 1, payload: [{ kind: 'type_param', name: 'E' }] },
      ],
    });

    // 1. Register struct headers first (allowing nested struct references)
    for (const st of module.structs) {
      if (this.structs.has(st.name)) {
        this.error('E_DUPLICATE_STRUCT', `Duplicate struct declaration '${st.name}'`, st.span);
      }
      this.structs.set(st.name, {
        kind: 'struct',
        name: st.name,
        typeArgs: st.typeParams.map((tp) => ({ kind: 'type_param', name: tp })),
        fields: [],
      });
    }

    // 1.5. Validate traits (honest diagnostic until trait dispatch and impl blocks are ready)
    if (module.traits && module.traits.length > 0) {
      for (const tr of module.traits) {
        this.diagnostics.push({
          code: 'E_UNIMPLEMENTED_FEATURE',
          severity: 'error',
          message: `The 'trait' construct ('${tr.name}') is not yet supported by the Manifest compiler and runtime backend. Use structs with function records or standalone functions.`,
          line: tr.span.line,
          column: tr.span.column,
          hint: 'Trait dispatch and `impl` blocks are scheduled for Phase 3.',
        });
      }
    }

    // 2. Register enum headers
    for (const en of module.enums) {
      if (this.enums.has(en.name)) {
        this.error('E_DUPLICATE_ENUM', `Duplicate enum declaration '${en.name}'`, en.span);
      }
      this.enums.set(en.name, {
        kind: 'enum',
        name: en.name,
        typeArgs: en.typeParams.map((tp) => ({ kind: 'type_param', name: tp })),
        variants: [],
      });
    }

    // 3. Populate struct fields
    for (const st of module.structs) {
      const tpSet = new Set(st.typeParams);
      const seenFields = new Set<string>();
      const fields = st.fields.map((f) => {
        if (seenFields.has(f.name)) {
          this.error('E_DUPLICATE_FIELD', `Duplicate field '${f.name}' in struct '${st.name}'`, f.span);
        }
        seenFields.add(f.name);
        return {
          name: f.name,
          type: resolveTypeNode(f.type, this.structs, this.enums, tpSet, this.diagnostics),
        };
      });
      this.structs.set(st.name, {
        kind: 'struct',
        name: st.name,
        typeArgs: st.typeParams.map((tp) => ({ kind: 'type_param', name: tp })),
        fields,
      });
    }

    // 4. Populate enum variants
    for (const en of module.enums) {
      const tpSet = new Set(en.typeParams);
      const variants = en.variants.map((v, idx) => ({
        name: v.name,
        tag: idx,
        payload: v.payloadTypes.map((pt) =>
          resolveTypeNode(pt, this.structs, this.enums, tpSet, this.diagnostics)
        ),
      }));
      this.enums.set(en.name, {
        kind: 'enum',
        name: en.name,
        typeArgs: en.typeParams.map((tp) => ({ kind: 'type_param', name: tp })),
        variants,
      });
    }

    // 5. Register function signatures
    for (const fn of module.functions) {
      if (this.functions.has(fn.name)) {
        this.error('E_DUPLICATE_FN', `Duplicate function '${fn.name}'`, fn.span);
      }
      const tpSet = new Set(fn.typeParams);
      const params = fn.params.map((p) => ({
        name: p.name,
        type: resolveTypeNode(p.type, this.structs, this.enums, tpSet, this.diagnostics),
      }));
      const returnType = resolveTypeNode(
        fn.returnType,
        this.structs,
        this.enums,
        tpSet,
        this.diagnostics
      );
      this.functions.set(fn.name, {
        name: fn.name,
        moduleName: module.moduleName,
        exported: fn.exported,
        isAsync: fn.isAsync,
        typeParams: fn.typeParams,
        params,
        returnType,
        declaredEffects: fn.effects,
        hasExplicitEffects: fn.hasExplicitEffects,
        span: fn.span,
      });
    }

    // 6. Check module constants & top-level statements
    const rootScope = new Map<string, SymbolEntry>();
    for (const c of module.constants) {
      const initType = this.inferExpr(c.init, [rootScope], new Set());
      const annotated =
        c.typeAnnotation.kind === 'InferredType'
          ? initType
          : resolveTypeNode(c.typeAnnotation, this.structs, this.enums, new Set(), this.diagnostics);
      if (!typesCompatible(annotated, initType)) {
        this.error(
          'E_CONST_TYPE_MISMATCH',
          `Constant '${c.name}' declared as '${formatSemanticType(annotated)}', got '${formatSemanticType(initType)}'`,
          c.span
        );
      }
      rootScope.set(c.name, {
        name: c.name,
        type: annotated,
        mutable: false,
        isConst: true,
        span: c.span,
      });
    }

    this.checkBlock(module.topLevelStmts, [rootScope], T_ANY, 0, false, new Set());

    // 7. Check each function body
    for (const fn of module.functions) {
      this.checkFunction(fn, rootScope);
    }

    return {
      valid: !this.diagnostics.some((d) => d.severity === 'error'),
      diagnostics: this.diagnostics,
      structs: this.structs,
      enums: this.enums,
      functions: this.functions,
      exprTypes: this.exprTypes,
    };
  }

  private checkFunction(fn: FnDecl, moduleScope: Map<string, SymbolEntry>): void {
    const sig = this.functions.get(fn.name)!;
    const fnScope = new Map<string, SymbolEntry>();
    const tpSet = new Set(fn.typeParams);

    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      if (fnScope.has(p.name)) {
        this.error('E_DUPLICATE_PARAM', `Duplicate parameter '${p.name}' in '${fn.name}'`, p.span);
      }
      fnScope.set(p.name, {
        name: p.name,
        type: sig.params[i].type,
        mutable: false,
        isConst: false,
        span: p.span,
      });
    }

    const definitelyReturns = this.checkBlock(
      fn.body,
      [moduleScope, fnScope],
      sig.returnType,
      0,
      fn.isAsync,
      tpSet
    );

    if (
      sig.returnType.kind !== 'void' &&
      sig.returnType.kind !== 'any' &&
      !definitelyReturns
    ) {
      this.error(
        'E_MISSING_RETURN',
        `Function '${fn.name}' must return a value of type '${formatSemanticType(sig.returnType)}' on all control-flow paths`,
        fn.span
      );
    }
  }

  private checkBlock(
    stmts: SemanticStmt[],
    scopes: Array<Map<string, SymbolEntry>>,
    expectedReturn: SemanticType,
    loopDepth: number,
    inAsync: boolean,
    typeParams: Set<string>
  ): boolean {
    const localScope = new Map<string, SymbolEntry>();
    const nextScopes = [...scopes, localScope];
    let returned = false;

    for (const stmt of stmts) {
      const stmtReturns = this.checkStmt(
        stmt,
        nextScopes,
        localScope,
        expectedReturn,
        loopDepth,
        inAsync,
        typeParams
      );
      if (stmtReturns) returned = true;
    }

    return returned;
  }

  private checkStmt(
    stmt: SemanticStmt,
    scopes: Array<Map<string, SymbolEntry>>,
    currentScope: Map<string, SymbolEntry>,
    expectedReturn: SemanticType,
    loopDepth: number,
    inAsync: boolean,
    typeParams: Set<string>
  ): boolean {
    switch (stmt.kind) {
      case 'VarStmt': {
        const d = stmt.decl;
        const initType = this.inferExpr(d.init, scopes, typeParams, inAsync);
        const targetType =
          d.typeAnnotation.kind === 'InferredType'
            ? initType
            : resolveTypeNode(
                d.typeAnnotation,
                this.structs,
                this.enums,
                typeParams,
                this.diagnostics
              );

        if (!typesCompatible(targetType, initType)) {
          this.error(
            'E_TYPE_MISMATCH',
            `Cannot assign value of type '${formatSemanticType(initType)}' to '${d.name}' of type '${formatSemanticType(targetType)}'`,
            d.span
          );
        }

        if (currentScope.has(d.name) && !this.isLegacyApp) {
          this.error('E_REDECLARATION', `Variable '${d.name}' is already declared in this scope`, d.span);
        }

        currentScope.set(d.name, {
          name: d.name,
          type: targetType,
          mutable: d.mutable,
          isConst: false,
          span: d.span,
        });
        return false;
      }

      case 'ConstStmt': {
        const d = stmt.decl;
        const initType = this.inferExpr(d.init, scopes, typeParams, inAsync);
        const targetType =
          d.typeAnnotation.kind === 'InferredType'
            ? initType
            : resolveTypeNode(
                d.typeAnnotation,
                this.structs,
                this.enums,
                typeParams,
                this.diagnostics
              );

        if (!typesCompatible(targetType, initType)) {
          this.error(
            'E_CONST_TYPE_MISMATCH',
            `Constant '${d.name}' expects '${formatSemanticType(targetType)}', got '${formatSemanticType(initType)}'`,
            d.span
          );
        }

        currentScope.set(d.name, {
          name: d.name,
          type: targetType,
          mutable: false,
          isConst: true,
          span: d.span,
        });
        return false;
      }

      case 'AssignStmt': {
        const valType = this.inferExpr(stmt.value, scopes, typeParams, inAsync);
        this.checkAssignTarget(stmt.target, valType, scopes, currentScope, typeParams, inAsync);
        return false;
      }

      case 'ExprStmt': {
        this.inferExpr(stmt.expr, scopes, typeParams, inAsync);
        return false;
      }

      case 'IfStmt': {
        const condType = this.inferExpr(stmt.condition, scopes, typeParams, inAsync);
        if (!typesCompatible(T_BOOL, condType)) {
          this.error(
            'E_COND_NOT_BOOL',
            `'if' condition must have type 'bool', found '${formatSemanticType(condType)}'`,
            stmt.condition.span
          );
        }
        const thenRet = this.checkBlock(
          stmt.thenBranch,
          scopes,
          expectedReturn,
          loopDepth,
          inAsync,
          typeParams
        );
        const elseRet =
          stmt.elseBranch.length > 0 &&
          this.checkBlock(
            stmt.elseBranch,
            scopes,
            expectedReturn,
            loopDepth,
            inAsync,
            typeParams
          );
        return Boolean(thenRet && elseRet);
      }

      case 'WhileStmt': {
        const condType = this.inferExpr(stmt.condition, scopes, typeParams, inAsync);
        if (!typesCompatible(T_BOOL, condType)) {
          this.error(
            'E_COND_NOT_BOOL',
            `'while' condition must have type 'bool', found '${formatSemanticType(condType)}'`,
            stmt.condition.span
          );
        }
        this.checkBlock(stmt.body, scopes, expectedReturn, loopDepth + 1, inAsync, typeParams);
        return false;
      }

      case 'ForInStmt': {
        const iterType = this.inferExpr(stmt.iterable, scopes, typeParams, inAsync);
        let elemType: SemanticType = T_ANY;
        if (iterType.kind === 'array') {
          elemType = iterType.element;
        } else if (iterType.kind !== 'any') {
          this.error(
            'E_NOT_ITERABLE',
            `Cannot iterate over value of type '${formatSemanticType(iterType)}' (expected Array<T>)`,
            stmt.iterable.span
          );
        }
        const loopScope = new Map<string, SymbolEntry>();
        loopScope.set(stmt.itemName, {
          name: stmt.itemName,
          type: elemType,
          mutable: false,
          isConst: false,
          span: stmt.span,
        });
        this.checkBlock(
          stmt.body,
          [...scopes, loopScope],
          expectedReturn,
          loopDepth + 1,
          inAsync,
          typeParams
        );
        return false;
      }

      case 'RepeatStmt': {
        const countType = this.inferExpr(stmt.count, scopes, typeParams, inAsync);
        if (!typesCompatible(T_I64, countType) && !(this.isLegacyApp && countType.kind === 'f64')) {
          this.error(
            'E_REPEAT_COUNT_TYPE',
            `Repeat count must be 'i64', found '${formatSemanticType(countType)}'`,
            stmt.count.span
          );
        }
        this.checkBlock(stmt.body, scopes, expectedReturn, loopDepth + 1, inAsync, typeParams);
        return false;
      }

      case 'BreakStmt': {
        if (loopDepth === 0) {
          this.error('E_BREAK_OUTSIDE_LOOP', `'break' cannot be used outside of a loop`, stmt.span);
        }
        return false;
      }

      case 'ContinueStmt': {
        if (loopDepth === 0) {
          this.error(
            'E_CONTINUE_OUTSIDE_LOOP',
            `'continue' cannot be used outside of a loop`,
            stmt.span
          );
        }
        return false;
      }

      case 'ReturnStmt': {
        if (!stmt.value) {
          if (!typesCompatible(expectedReturn, T_VOID)) {
            this.error(
              'E_RETURN_TYPE_MISMATCH',
              `Expected return value of type '${formatSemanticType(expectedReturn)}', found empty return`,
              stmt.span
            );
          }
          return true;
        }
        const valType = this.inferExpr(stmt.value, scopes, typeParams, inAsync);
        if (!typesCompatible(expectedReturn, valType)) {
          this.error(
            'E_RETURN_TYPE_MISMATCH',
            `Return type mismatch: expected '${formatSemanticType(expectedReturn)}', got '${formatSemanticType(valType)}'`,
            stmt.span
          );
        }
        return true;
      }

      case 'MatchStmt': {
        const subjType = this.inferExpr(stmt.subject, scopes, typeParams, inAsync);
        let hasWildcard = false;
        const coveredVariants = new Set<string>();
        let allArmsReturn = stmt.arms.length > 0;

        for (const arm of stmt.arms) {
          const armScope = new Map<string, SymbolEntry>();
          this.bindPattern(arm.pattern, subjType, armScope, coveredVariants);
          if (arm.pattern.kind === 'WildcardPattern') hasWildcard = true;

          const armRet = this.checkBlock(
            arm.body,
            [...scopes, armScope],
            expectedReturn,
            loopDepth,
            inAsync,
            typeParams
          );
          if (!armRet) allArmsReturn = false;
        }

        if (subjType.kind === 'enum' && !hasWildcard) {
          const missing = subjType.variants
            .map((v) => v.name)
            .filter((vn) => !coveredVariants.has(vn));
          if (missing.length > 0) {
            this.error(
              'E_NON_EXHAUSTIVE_MATCH',
              `Non-exhaustive match on '${subjType.name}': missing variant(s) ${missing.join(', ')}`,
              stmt.span,
              `Add match arms for ${missing.join(', ')} or a wildcard '_' / 'ELSE' branch.`
            );
          }
        } else if (subjType.kind === 'result' && !hasWildcard) {
          const missing = ['Ok', 'Err'].filter((vn) => !coveredVariants.has(vn));
          if (missing.length > 0) {
            this.error(
              'E_NON_EXHAUSTIVE_MATCH',
              `Non-exhaustive match on '${formatSemanticType(subjType)}': missing variant(s) ${missing.join(', ')}`,
              stmt.span,
              `Add match arms for ${missing.join(', ')} or a wildcard '_' / 'ELSE' branch.`
            );
          }
        } else if (
          subjType.kind !== 'enum' &&
          subjType.kind !== 'result' &&
          subjType.kind !== 'any' &&
          !hasWildcard
        ) {
          this.error(
            'E_NON_EXHAUSTIVE_MATCH',
            `Match on '${formatSemanticType(subjType)}' requires a wildcard '_' / 'ELSE' fallback arm`,
            stmt.span
          );
        }

        return (
          allArmsReturn &&
          (hasWildcard || subjType.kind === 'enum' || subjType.kind === 'result')
        );
      }

      case 'TryStmt': {
        this.error(
          'E_UNIMPLEMENTED_FEATURE',
          `The 'try / catch' construct is not yet supported in the Manifest runtime pipeline. Use Result<T, E> (Ok / Err) and 'match' for explicit error handling.`,
          stmt.span,
          `Replace 'try { ... } catch' with a function returning 'Result<T, str>' and handle with 'match'.`
        );
        this.checkBlock(stmt.tryBody, scopes, expectedReturn, loopDepth, inAsync, typeParams);
        const catchScope = new Map<string, SymbolEntry>();
        if (stmt.errBinding) {
          catchScope.set(stmt.errBinding, {
            name: stmt.errBinding,
            type: T_STR,
            mutable: false,
            isConst: false,
            span: stmt.span,
          });
        }
        this.checkBlock(
          stmt.catchBody,
          [...scopes, catchScope],
          expectedReturn,
          loopDepth,
          inAsync,
          typeParams
        );
        return false;
      }
    }
  }

  private bindPattern(
    pat: MatchPattern,
    subjType: SemanticType,
    armScope: Map<string, SymbolEntry>,
    coveredVariants: Set<string>
  ): void {
    if (pat.kind === 'WildcardPattern') return;
    if (pat.kind === 'LiteralPattern') {
      const litType =
        typeof pat.value === 'number'
          ? pat.isFloat
            ? T_F64
            : T_I64
          : typeof pat.value === 'boolean'
            ? T_BOOL
            : T_STR;
      if (!typesCompatible(subjType, litType)) {
        this.error(
          'E_PATTERN_TYPE_MISMATCH',
          `Pattern literal of type '${formatSemanticType(litType)}' cannot match '${formatSemanticType(subjType)}'`,
          pat.span
        );
      }
      return;
    }

    if (subjType.kind === 'enum') {
      if (pat.enumName && pat.enumName !== subjType.name) {
        this.error(
          'E_PATTERN_ENUM_MISMATCH',
          `Expected variant of enum '${subjType.name}', got '${pat.enumName}'`,
          pat.span
        );
        return;
      }
      const variant = subjType.variants.find((v) => v.name === pat.variantName);
      if (!variant) {
        this.error(
          'E_UNKNOWN_VARIANT',
          `Enum '${subjType.name}' has no variant '${pat.variantName}'`,
          pat.span
        );
        return;
      }
      coveredVariants.add(variant.name);
      if (pat.bindings.length !== variant.payload.length) {
        this.error(
          'E_VARIANT_ARITY',
          `Variant '${subjType.name}::${variant.name}' expects ${variant.payload.length} binding(s), got ${pat.bindings.length}`,
          pat.span
        );
      }
      for (let i = 0; i < pat.bindings.length; i++) {
        armScope.set(pat.bindings[i], {
          name: pat.bindings[i],
          type: variant.payload[i] || T_ANY,
          mutable: false,
          isConst: false,
          span: pat.span,
        });
      }
    } else if (subjType.kind === 'result') {
      const variantName = pat.variantName;
      if (variantName !== 'Ok' && variantName !== 'Err') {
        this.error('E_UNKNOWN_VARIANT', `Result pattern expects Ok(v) or Err(e)`, pat.span);
        return;
      }
      coveredVariants.add(variantName);
      if (pat.bindings[0]) {
        armScope.set(pat.bindings[0], {
          name: pat.bindings[0],
          type: variantName === 'Ok' ? subjType.ok : subjType.err,
          mutable: false,
          isConst: false,
          span: pat.span,
        });
      }
    } else {
      for (const b of pat.bindings) {
        armScope.set(b, {
          name: b,
          type: T_ANY,
          mutable: false,
          isConst: false,
          span: pat.span,
        });
      }
    }
  }

  private checkAssignTarget(
    target: AssignTarget,
    valType: SemanticType,
    scopes: Array<Map<string, SymbolEntry>>,
    currentScope: Map<string, SymbolEntry>,
    typeParams: Set<string>,
    inAsync: boolean
  ): void {
    if (target.kind === 'VarTarget') {
      const sym = this.lookupSymbol(target.name, scopes);
      if (!sym) {
        if (this.isLegacyApp) {
          currentScope.set(target.name, {
            name: target.name,
            type: valType,
            mutable: true,
            isConst: false,
            span: target.span,
          });
          return;
        }
        this.error(
          'E_UNDEFINED_VAR',
          `Cannot assign to undeclared variable '${target.name}'`,
          target.span,
          `Declare it first with 'let mut ${target.name} = ...' or 'MUTABLE ${target.name} = ...'.`
        );
        return;
      }
      if (sym.isConst) {
        this.error(
          'E_ASSIGN_CONST',
          `Cannot reassign constant '${target.name}'`,
          target.span
        );
        return;
      }
      if (!sym.mutable) {
        this.error(
          'E_ASSIGN_IMMUTABLE',
          `Cannot mutate immutable variable '${target.name}'`,
          target.span,
          `Declare '${target.name}' as mutable using 'let mut' (Professional) or 'MUTABLE' (Beginner).`
        );
        return;
      }
      if (!typesCompatible(sym.type, valType)) {
        this.error(
          'E_TYPE_MISMATCH',
          `Cannot assign '${formatSemanticType(valType)}' to '${target.name}' of type '${formatSemanticType(sym.type)}'`,
          target.span
        );
      }
      return;
    }

    if (target.kind === 'FieldTarget') {
      if (target.object.kind === 'Identifier') {
        const rootSym = this.lookupSymbol(target.object.name, scopes);
        if (rootSym && !rootSym.mutable) {
          this.error(
            'E_ASSIGN_IMMUTABLE',
            `Cannot mutate field '${target.field}' of immutable binding '${target.object.name}'`,
            target.span
          );
        }
      }
      const objType = this.inferExpr(target.object, scopes, typeParams, inAsync);
      if (objType.kind === 'struct') {
        const f = objType.fields.find((x) => x.name === target.field);
        if (!f) {
          this.error(
            'E_UNKNOWN_FIELD',
            `Struct '${objType.name}' has no field '${target.field}'`,
            target.span
          );
        } else if (!typesCompatible(f.type, valType)) {
          this.error(
            'E_TYPE_MISMATCH',
            `Field '${objType.name}.${target.field}' expects '${formatSemanticType(f.type)}', got '${formatSemanticType(valType)}'`,
            target.span
          );
        }
      }
      return;
    }

    if (target.kind === 'IndexTarget') {
      if (target.object.kind === 'Identifier') {
        const rootSym = this.lookupSymbol(target.object.name, scopes);
        if (rootSym && !rootSym.mutable) {
          this.error(
            'E_ASSIGN_IMMUTABLE',
            `Cannot mutate element of immutable collection '${target.object.name}'`,
            target.span
          );
        }
      }
      const objType = this.inferExpr(target.object, scopes, typeParams, inAsync);
      const idxType = this.inferExpr(target.index, scopes, typeParams, inAsync);
      if (objType.kind === 'array') {
        if (!typesCompatible(T_I64, idxType)) {
          this.error(
            'E_INDEX_TYPE',
            `Array index must be 'i64', got '${formatSemanticType(idxType)}'`,
            target.index.span
          );
        }
        if (!typesCompatible(objType.element, valType)) {
          this.error(
            'E_TYPE_MISMATCH',
            `Array element expects '${formatSemanticType(objType.element)}', got '${formatSemanticType(valType)}'`,
            target.span
          );
        }
      } else if (objType.kind === 'map') {
        if (!typesCompatible(objType.key, idxType)) {
          this.error(
            'E_KEY_TYPE',
            `Map key expects '${formatSemanticType(objType.key)}', got '${formatSemanticType(idxType)}'`,
            target.index.span
          );
        }
        if (!typesCompatible(objType.value, valType)) {
          this.error(
            'E_TYPE_MISMATCH',
            `Map value expects '${formatSemanticType(objType.value)}', got '${formatSemanticType(valType)}'`,
            target.span
          );
        }
      }
    }
  }

  private inferExpr(
    expr: SemanticExpr,
    scopes: Array<Map<string, SymbolEntry>>,
    typeParams: Set<string>,
    inAsync = false
  ): SemanticType {
    const t = this.inferExprInner(expr, scopes, typeParams, inAsync);
    this.exprTypes.set(expr, t);
    return t;
  }

  private inferExprInner(
    expr: SemanticExpr,
    scopes: Array<Map<string, SymbolEntry>>,
    typeParams: Set<string>,
    inAsync: boolean
  ): SemanticType {
    switch (expr.kind) {
      case 'IntLiteral': {
        const min = -9223372036854775808n;
        const max = 9223372036854775807n;
        if (expr.value < min || expr.value > max) {
          this.error(
            'E_INT_LITERAL_OVERFLOW',
            `Integer literal '${expr.raw}' overflows signed 64-bit integer range (i64)`,
            expr.span
          );
        }
        return T_I64;
      }
      case 'FloatLiteral':
        return T_F64;
      case 'BoolLiteral':
        return T_BOOL;
      case 'StringLiteral':
        return T_STR;

      case 'Identifier': {
        const sym = this.lookupSymbol(expr.name, scopes);
        if (!sym) {
          this.error('E_UNDEFINED_VAR', `Undefined identifier '${expr.name}'`, expr.span);
          return T_ANY;
        }
        return sym.type;
      }

      case 'UnaryExpr': {
        const opType = this.inferExpr(expr.operand, scopes, typeParams, inAsync);
        if (expr.op === '-') {
          if (opType.kind === 'i64' || opType.kind === 'f64' || opType.kind === 'any') {
            return opType;
          }
          this.error(
            'E_UNARY_NEG_TYPE',
            `Unary '-' requires 'i64' or 'f64', found '${formatSemanticType(opType)}'`,
            expr.span
          );
          return T_I64;
        }
        if (expr.op === '!') {
          if (!typesCompatible(T_BOOL, opType)) {
            this.error(
              'E_UNARY_NOT_TYPE',
              `Logical '!' requires 'bool', found '${formatSemanticType(opType)}'`,
              expr.span
            );
          }
          return T_BOOL;
        }
        return T_ANY;
      }

      case 'BinaryExpr': {
        const lt = this.inferExpr(expr.left, scopes, typeParams, inAsync);
        const rt = this.inferExpr(expr.right, scopes, typeParams, inAsync);

        if (expr.op === '&&' || expr.op === '||') {
          if (!typesCompatible(T_BOOL, lt) || !typesCompatible(T_BOOL, rt)) {
            this.error(
              'E_LOGICAL_OP_TYPE',
              `Logical operator '${expr.op}' requires 'bool' operands, got '${formatSemanticType(lt)}' and '${formatSemanticType(rt)}'`,
              expr.span
            );
          }
          return T_BOOL;
        }

        if (expr.op === '==' || expr.op === '!=') {
          if (!typesCompatible(lt, rt)) {
            this.error(
              'E_EQ_TYPE_MISMATCH',
              `Cannot compare '${formatSemanticType(lt)}' and '${formatSemanticType(rt)}' with '${expr.op}'`,
              expr.span
            );
          }
          return T_BOOL;
        }

        if (expr.op === '<' || expr.op === '<=' || expr.op === '>' || expr.op === '>=') {
          if (
            !typesCompatible(lt, rt) ||
            (lt.kind !== 'i64' && lt.kind !== 'f64' && lt.kind !== 'str' && lt.kind !== 'any')
          ) {
            this.error(
              'E_CMP_TYPE_MISMATCH',
              `Ordered comparison '${expr.op}' requires matching 'i64', 'f64', or 'str' operands, got '${formatSemanticType(lt)}' and '${formatSemanticType(rt)}'`,
              expr.span
            );
          }
          return T_BOOL;
        }

        if (expr.op === '+') {
          if (lt.kind === 'str' && rt.kind === 'str') return T_STR;
          // Legacy APP compatibility allows string + primitive in SHOW
          if (this.isLegacyApp && (lt.kind === 'str' || rt.kind === 'str')) {
            return T_STR;
          }
          if (lt.kind === 'i64' && rt.kind === 'i64') return T_I64;
          if (lt.kind === 'f64' && rt.kind === 'f64') return T_F64;
          if (lt.kind === 'any' || rt.kind === 'any') return lt.kind === 'any' ? rt : lt;
          this.error(
            'E_ARITH_TYPE_MISMATCH',
            `Operator '+' is not defined for '${formatSemanticType(lt)}' and '${formatSemanticType(rt)}' (no implicit type coercion)`,
            expr.span,
            lt.kind === 'str' || rt.kind === 'str'
              ? `Use 'to_str(...)' to convert non-string values explicitly before '+' concatenation.`
              : `Use 'to_f64(...)' or 'to_i64(...)' to convert between 'i64' and 'f64'.`
          );
          return T_ANY;
        }

        if (expr.op === '-' || expr.op === '*' || expr.op === '/' || expr.op === '%') {
          if (lt.kind === 'i64' && rt.kind === 'i64') return T_I64;
          if (lt.kind === 'f64' && rt.kind === 'f64') return T_F64;
          if (lt.kind === 'any' || rt.kind === 'any') return lt.kind === 'any' ? rt : lt;
          this.error(
            'E_ARITH_TYPE_MISMATCH',
            `Arithmetic operator '${expr.op}' requires matching 'i64' or 'f64' operands, got '${formatSemanticType(lt)}' and '${formatSemanticType(rt)}'`,
            expr.span
          );
          return T_ANY;
        }

        return T_ANY;
      }

      case 'ArrayLiteral': {
        if (expr.elements.length === 0) {
          return { kind: 'array', element: T_ANY };
        }
        const firstT = this.inferExpr(expr.elements[0], scopes, typeParams, inAsync);
        for (let i = 1; i < expr.elements.length; i++) {
          const et = this.inferExpr(expr.elements[i], scopes, typeParams, inAsync);
          if (!typesCompatible(firstT, et)) {
            this.error(
              'E_ARRAY_HOMOGENEITY',
              `Array elements must have uniform type: expected '${formatSemanticType(firstT)}', found '${formatSemanticType(et)}' at index ${i}`,
              expr.elements[i].span
            );
          }
        }
        return { kind: 'array', element: firstT };
      }

      case 'MapLiteral': {
        if (expr.entries.length === 0) {
          return { kind: 'map', key: T_STR, value: T_ANY };
        }
        const kt = this.inferExpr(expr.entries[0].key, scopes, typeParams, inAsync);
        const vt = this.inferExpr(expr.entries[0].value, scopes, typeParams, inAsync);
        if (!typesCompatible(T_STR, kt)) {
          this.error(
            'E_MAP_KEY_TYPE',
            `Map literal keys must be 'str', found '${formatSemanticType(kt)}'`,
            expr.entries[0].key.span
          );
        }
        for (let i = 1; i < expr.entries.length; i++) {
          const ek = this.inferExpr(expr.entries[i].key, scopes, typeParams, inAsync);
          const ev = this.inferExpr(expr.entries[i].value, scopes, typeParams, inAsync);
          if (!typesCompatible(kt, ek) || !typesCompatible(vt, ev)) {
            this.error(
              'E_MAP_HOMOGENEITY',
              `Map entries must have consistent key/value types`,
              expr.entries[i].key.span
            );
          }
        }
        return { kind: 'map', key: T_STR, value: vt };
      }

      case 'IndexAccessExpr': {
        const objT = this.inferExpr(expr.object, scopes, typeParams, inAsync);
        const idxT = this.inferExpr(expr.index, scopes, typeParams, inAsync);
        if (objT.kind === 'array') {
          if (!typesCompatible(T_I64, idxT)) {
            this.error(
              'E_INDEX_TYPE',
              `Array index must be 'i64', got '${formatSemanticType(idxT)}'`,
              expr.index.span
            );
          }
          return objT.element;
        }
        if (objT.kind === 'map') {
          if (!typesCompatible(objT.key, idxT)) {
            this.error(
              'E_KEY_TYPE',
              `Map key expects '${formatSemanticType(objT.key)}', got '${formatSemanticType(idxT)}'`,
              expr.index.span
            );
          }
          return objT.value;
        }
        if (objT.kind === 'any') return T_ANY;
        this.error(
          'E_NOT_INDEXABLE',
          `Cannot index into type '${formatSemanticType(objT)}'`,
          expr.span
        );
        return T_ANY;
      }

      case 'FieldAccessExpr': {
        const objT = this.inferExpr(expr.object, scopes, typeParams, inAsync);
        if (objT.kind === 'struct') {
          const f = objT.fields.find((x) => x.name === expr.field);
          if (!f) {
            this.error(
              'E_UNKNOWN_FIELD',
              `Struct '${objT.name}' has no field '${expr.field}'`,
              expr.span
            );
            return T_ANY;
          }
          return f.type;
        }
        if (objT.kind === 'array' && expr.field === 'length') {
          return T_I64;
        }
        if (objT.kind === 'any') return T_ANY;
        this.error(
          'E_FIELD_ON_NON_STRUCT',
          `Cannot access field '${expr.field}' on value of type '${formatSemanticType(objT)}'`,
          expr.span
        );
        return T_ANY;
      }

      case 'StructLiteral': {
        const st = this.structs.get(expr.structName);
        if (!st || st.kind !== 'struct') {
          this.error('E_UNKNOWN_STRUCT', `Unknown struct '${expr.structName}'`, expr.span);
          return T_ANY;
        }
        const provided = new Map<string, SemanticType>();
        for (const f of expr.fields) {
          const vt = this.inferExpr(f.value, scopes, typeParams, inAsync);
          provided.set(f.name, vt);
        }

        // Infer generic type arguments if struct has typeParams
        const bindings = new Map<string, SemanticType>();
        for (const sf of st.fields) {
          const actual = provided.get(sf.name);
          if (!actual) {
            this.error(
              'E_MISSING_STRUCT_FIELD',
              `Missing field '${sf.name}' in initialization of '${st.name}'`,
              expr.span
            );
            continue;
          }
          if (sf.type.kind === 'type_param') {
            bindings.set(sf.type.name, actual);
          }
        }

        const instantiated = substituteTypeParams(st, bindings);
        if (instantiated.kind === 'struct') {
          for (const f of expr.fields) {
            const declField = instantiated.fields.find((df) => df.name === f.name);
            if (!declField) {
              this.error(
                'E_EXTRA_STRUCT_FIELD',
                `Struct '${st.name}' has no field '${f.name}'`,
                f.span
              );
            } else {
              const actual = provided.get(f.name)!;
              if (!typesCompatible(declField.type, actual)) {
                this.error(
                  'E_FIELD_TYPE_MISMATCH',
                  `Field '${st.name}.${f.name}' expects '${formatSemanticType(declField.type)}', got '${formatSemanticType(actual)}'`,
                  f.span
                );
              }
            }
          }
        }
        return instantiated;
      }

      case 'EnumConstructExpr': {
        if (expr.enumName === 'Result') {
          if (expr.variantName !== 'Ok' && expr.variantName !== 'Err') {
            this.error('E_UNKNOWN_VARIANT', `Enum 'Result' has no variant '${expr.variantName}'`, expr.span);
            return { kind: 'result', ok: T_ANY, err: T_ANY };
          }
          if (expr.args.length !== 1) {
            this.error(
              'E_VARIANT_ARITY',
              `Variant 'Result::${expr.variantName}' expects 1 argument, got ${expr.args.length}`,
              expr.span
            );
            return { kind: 'result', ok: T_ANY, err: T_ANY };
          }
          const argT = this.inferExpr(expr.args[0], scopes, typeParams, inAsync);
          return expr.variantName === 'Ok'
            ? { kind: 'result', ok: argT, err: T_ANY }
            : { kind: 'result', ok: T_ANY, err: argT };
        }

        const en = this.enums.get(expr.enumName);
        if (!en || en.kind !== 'enum') {
          this.error('E_UNKNOWN_ENUM', `Unknown enum '${expr.enumName}'`, expr.span);
          return T_ANY;
        }
        const variant = en.variants.find((v) => v.name === expr.variantName);
        if (!variant) {
          this.error(
            'E_UNKNOWN_VARIANT',
            `Enum '${expr.enumName}' has no variant '${expr.variantName}'`,
            expr.span
          );
          return en;
        }
        if (expr.args.length !== variant.payload.length) {
          this.error(
            'E_VARIANT_ARITY',
            `Variant '${expr.enumName}::${expr.variantName}' expects ${variant.payload.length} argument(s), got ${expr.args.length}`,
            expr.span
          );
          return en;
        }

        const bindings = new Map<string, SemanticType>();
        for (let i = 0; i < expr.args.length; i++) {
          const argT = this.inferExpr(expr.args[i], scopes, typeParams, inAsync);
          const patT = variant.payload[i];
          if (patT.kind === 'type_param') {
            bindings.set(patT.name, argT);
          } else if (!typesCompatible(patT, argT)) {
            this.error(
              'E_VARIANT_ARG_TYPE',
              `Variant '${expr.enumName}::${expr.variantName}' argument ${i + 1} expects '${formatSemanticType(patT)}', got '${formatSemanticType(argT)}'`,
              expr.args[i].span
            );
          }
        }
        return substituteTypeParams(en, bindings);
      }

      case 'CallExpr': {
        const argTypes = expr.args.map((a) => this.inferExpr(a, scopes, typeParams, inAsync));

        // Built-in collection mutators: `push(arr, item)` or `arr.push(item)`
        if (expr.callee === 'push' || expr.callee === 'array.push') {
          if (argTypes.length !== 2 || (argTypes[0].kind !== 'array' && argTypes[0].kind !== 'any')) {
            this.error('E_CALL_ARITY', `'push' expects (Array<T>, T)`, expr.span);
            return T_VOID;
          }
          if (argTypes[0].kind === 'array' && !typesCompatible(argTypes[0].element, argTypes[1])) {
            this.error(
              'E_ARRAY_PUSH_TYPE',
              `Cannot push '${formatSemanticType(argTypes[1])}' onto '${formatSemanticType(argTypes[0])}'`,
              expr.span
            );
          }
          return T_VOID;
        }

        if (expr.callee === 'has' || expr.callee === 'map.has') {
          return T_BOOL;
        }

        // Result constructors `Ok(v)` / `Err(e)`
        if (expr.callee === 'Ok' && argTypes.length === 1) {
          return { kind: 'result', ok: argTypes[0], err: T_ANY };
        }
        if (expr.callee === 'Err' && argTypes.length === 1) {
          return { kind: 'result', ok: T_ANY, err: argTypes[0] };
        }

        // Standard library / host intrinsic
        const std = lookupStdIntrinsic(expr.callee);
        if (std) {
          if (!std.variadicAny && argTypes.length !== std.params.length) {
            this.error(
              'E_CALL_ARITY',
              `Function '${expr.callee}' expects ${std.params.length} argument(s), got ${argTypes.length}`,
              expr.span
            );
            return std.returnType;
          }
          if (!std.variadicAny) {
            for (let i = 0; i < std.params.length; i++) {
              if (!typesCompatible(std.params[i], argTypes[i])) {
                this.error(
                  'E_ARG_TYPE_MISMATCH',
                  `Argument ${i + 1} of '${expr.callee}' expects '${formatSemanticType(std.params[i])}', got '${formatSemanticType(argTypes[i])}'`,
                  expr.args[i].span
                );
              }
            }
          }
          return std.returnType;
        }

        // User-defined function
        const fnSig = this.functions.get(expr.callee);
        if (!fnSig) {
          this.error('E_UNDEFINED_FN', `Call to undefined function '${expr.callee}'`, expr.span);
          return T_ANY;
        }

        if (argTypes.length !== fnSig.params.length) {
          this.error(
            'E_CALL_ARITY',
            `Function '${fnSig.name}' expects ${fnSig.params.length} argument(s), got ${argTypes.length}`,
            expr.span
          );
          return fnSig.returnType;
        }

        // Instantiate generic type parameters recursively from call arguments
        const tpBindings = new Map<string, SemanticType>();
        for (let i = 0; i < fnSig.params.length; i++) {
          const expectedP = fnSig.params[i].type;
          const conflictParam = this.unifyGenericParam(expectedP, argTypes[i], tpBindings);
          if (conflictParam) {
            this.error(
              'E_GENERIC_CONFLICT',
              `Conflicting types inferred for type parameter '${conflictParam}' in call to '${fnSig.name}'`,
              expr.args[i].span
            );
          } else {
            const subExpected = substituteTypeParams(expectedP, tpBindings);
            if (!typesCompatible(subExpected, argTypes[i])) {
              this.error(
                'E_ARG_TYPE_MISMATCH',
                `Argument '${fnSig.params[i].name}' of '${fnSig.name}' expects '${formatSemanticType(subExpected)}', got '${formatSemanticType(argTypes[i])}'`,
                expr.args[i].span
              );
            }
          }
        }

        return substituteTypeParams(fnSig.returnType, tpBindings);
      }

      case 'AwaitExpr': {
        if (!inAsync) {
          this.error(
            'E_AWAIT_OUTSIDE_ASYNC',
            `'await' can only be used inside an 'async' function`,
            expr.span
          );
        }
        return this.inferExpr(expr.operand, scopes, typeParams, inAsync);
      }

      case 'TryPropagateExpr': {
        const inner = this.inferExpr(expr.operand, scopes, typeParams, inAsync);
        if (inner.kind === 'result') {
          return inner.ok;
        }
        return inner;
      }
    }
  }

  private lookupSymbol(
    name: string,
    scopes: Array<Map<string, SymbolEntry>>
  ): SymbolEntry | undefined {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const found = scopes[i].get(name);
      if (found) return found;
    }
    return undefined;
  }

  private unifyGenericParam(
    pattern: SemanticType,
    actual: SemanticType,
    bindings: Map<string, SemanticType>
  ): string | null {
    if (actual.kind === 'any') return null;
    if (pattern.kind === 'type_param') {
      const prev = bindings.get(pattern.name);
      if (prev && !typesCompatible(prev, actual)) {
        return pattern.name;
      }
      bindings.set(pattern.name, actual);
      return null;
    }
    if (pattern.kind === 'array' && actual.kind === 'array') {
      return this.unifyGenericParam(pattern.element, actual.element, bindings);
    }
    if (pattern.kind === 'map' && actual.kind === 'map') {
      return (
        this.unifyGenericParam(pattern.key, actual.key, bindings) ||
        this.unifyGenericParam(pattern.value, actual.value, bindings)
      );
    }
    if (pattern.kind === 'result' && actual.kind === 'result') {
      return (
        this.unifyGenericParam(pattern.ok, actual.ok, bindings) ||
        this.unifyGenericParam(pattern.err, actual.err, bindings)
      );
    }
    if (
      (pattern.kind === 'struct' && actual.kind === 'struct' && pattern.name === actual.name) ||
      (pattern.kind === 'enum' && actual.kind === 'enum' && pattern.name === actual.name)
    ) {
      const len = Math.min(pattern.typeArgs.length, actual.typeArgs.length);
      for (let i = 0; i < len; i++) {
        const c = this.unifyGenericParam(pattern.typeArgs[i], actual.typeArgs[i], bindings);
        if (c) return c;
      }
    }
    return null;
  }

  private error(code: string, message: string, span: SourceSpan, hint?: string): void {
    this.diagnostics.push({
      code,
      severity: 'error',
      message,
      line: span.line,
      column: span.column,
      file: span.file,
      hint,
    });
  }
}
