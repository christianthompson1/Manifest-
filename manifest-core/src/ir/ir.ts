/**
 * Manifest IR (Intermediate Representation)
 * Target-agnostic semantic representation of Manifest code.
 *
 * Manifest IR isolates language semantics from concrete target platforms
 * (JS/Web, TypeScript, WebAssembly, Rust, Solana, etc.).
 */

export type IRNodeType =
  | 'IRProgram'
  | 'IRVariableDecl'
  | 'IRAssignment'
  | 'IRShow'
  | 'IRIf'
  | 'IRBranch'
  | 'IRLoop'
  | 'IRForEach'
  | 'IRActionDecl'
  | 'IRActionCall'
  | 'IRReturn'
  | 'IREventHandler'
  | 'IRTryCatch'
  | 'IRLiteral'
  | 'IRArray'
  | 'IRVariableRef'
  | 'IRBinaryOp'
  | 'IRUnaryOp'
  | 'IRIndexAccess'
  // Manifest v0.2 Application UI Primitives
  | 'IRState'
  | 'IRPage'
  | 'IRText'
  | 'IRButton'
  | 'IRInput'
  | 'IRImage'
  | 'IRForm'
  | 'IRRoute'
  | 'IRNavigate'
  // Manifest v0.3 UI Primitives & Design System
  | 'IRContainer'
  | 'IRCard'
  | 'IRList'
  | 'IRLink'
  | 'IRSelect'
  | 'IRCheckbox'
  | 'IRTextarea'
  | 'IRHeader'
  | 'IRFooter'
  | 'IRNav'
  | 'IRModal'
  | 'IRComponentDecl'
  | 'IRComponentCall'
  // Manifest v0.4 UI Primitives
  | 'IRTable'
  | 'IRDialog'
  | 'IRTabs'
  | 'IRMenu'
  | 'IRSidebar'
  | 'IRAvatar'
  | 'IRBadge'
  | 'IRProgress'
  | 'IRIcon'
  | 'IRVideo'
  | 'IRAudio'
  // Escape Hatches & Libraries
  | 'IRCssEscape'
  | 'IRJsEscape'
  | 'IRRustEscape'
  | 'IRLibraryDecl'
  | 'IRAnimate'
  // Solana
  | 'IRSolanaProgram'
  | 'IRSolanaAccount'
  | 'IRSolanaInstruction'
  | 'IRSolanaRequire'
  | 'IRSolanaCPI';

export interface IRBaseNode {
  kind: IRNodeType;
  sourceLine?: number;
  sourceColumn?: number;
}

// ----------------------------------------------------
// IR Expressions
// ----------------------------------------------------

export type IRLiteralValue = string | number | boolean | null;

export interface IRLiteralNode extends IRBaseNode {
  kind: 'IRLiteral';
  value: IRLiteralValue;
  dataType: 'string' | 'number' | 'boolean' | 'null';
}

export interface IRArrayNode extends IRBaseNode {
  kind: 'IRArray';
  elements: IRExpressionNode[];
}

export interface IRVariableRefNode extends IRBaseNode {
  kind: 'IRVariableRef';
  name: string;
}

export type IROperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'AND'
  | 'OR'
  | 'NOT';

export interface IRBinaryOpNode extends IRBaseNode {
  kind: 'IRBinaryOp';
  operator: IROperator;
  left: IRExpressionNode;
  right: IRExpressionNode;
}

export interface IRUnaryOpNode extends IRBaseNode {
  kind: 'IRUnaryOp';
  operator: 'NOT' | '-' | '+';
  argument: IRExpressionNode;
}

export interface IRActionCallNode extends IRBaseNode {
  kind: 'IRActionCall';
  actionName: string;
  arguments: IRExpressionNode[];
}

export interface IRIndexAccessNode extends IRBaseNode {
  kind: 'IRIndexAccess';
  target: IRExpressionNode;
  index: IRExpressionNode;
}

export type IRExpressionNode =
  | IRLiteralNode
  | IRArrayNode
  | IRVariableRefNode
  | IRBinaryOpNode
  | IRUnaryOpNode
  | IRActionCallNode
  | IRIndexAccessNode;

// ----------------------------------------------------
// IR Statements & Instructions
// ----------------------------------------------------

export interface IRVariableDeclNode extends IRBaseNode {
  kind: 'IRVariableDecl';
  name: string;
  initialValue: IRExpressionNode;
  isExported?: boolean;
}

export interface IRAssignmentNode extends IRBaseNode {
  kind: 'IRAssignment';
  target: string;
  value: IRExpressionNode;
}

export interface IRShowNode extends IRBaseNode {
  kind: 'IRShow';
  expression: IRExpressionNode;
}

export interface IRBranch {
  condition?: IRExpressionNode; // undefined for ELSE branch
  body: IRInstructionNode[];
  sourceLine?: number;
}

export interface IRIfNode extends IRBaseNode {
  kind: 'IRIf';
  condition: IRExpressionNode;
  thenBody: IRInstructionNode[];
  elseIfBranches: Array<{ condition: IRExpressionNode; body: IRInstructionNode[]; sourceLine?: number }>;
  elseBody?: IRInstructionNode[];
}

export interface IRLoopNode extends IRBaseNode {
  kind: 'IRLoop';
  loopType: 'repeat';
  count: IRExpressionNode;
  body: IRInstructionNode[];
}

export interface IRForEachNode extends IRBaseNode {
  kind: 'IRForEach';
  iteratorVar: string;
  collection: IRExpressionNode;
  body: IRInstructionNode[];
}

export interface IRActionDeclNode extends IRBaseNode {
  kind: 'IRActionDecl';
  name: string;
  parameters: string[];
  body: IRInstructionNode[];
}

export interface IRReturnNode extends IRBaseNode {
  kind: 'IRReturn';
  value?: IRExpressionNode;
}

export interface IREventHandlerNode extends IRBaseNode {
  kind: 'IREventHandler';
  eventName: string;
  body: IRInstructionNode[];
}

export interface IRTryCatchNode extends IRBaseNode {
  kind: 'IRTryCatch';
  tryBody: IRInstructionNode[];
  catchBody: IRInstructionNode[];
}

// ----------------------------------------------------
// Manifest v0.2 UI IR Nodes
// ----------------------------------------------------

export interface IRStateNode extends IRBaseNode {
  kind: 'IRState';
  name: string;
  initialValue: IRExpressionNode;
}

export interface IRTextNode extends IRBaseNode {
  kind: 'IRText';
  expression: IRExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IRButtonNode extends IRBaseNode {
  kind: 'IRButton';
  label: IRExpressionNode;
  eventHandlers: IREventHandlerNode[];
  styles?: Record<string, string | number>;
}

export interface IRInputNode extends IRBaseNode {
  kind: 'IRInput';
  placeholder?: IRExpressionNode;
  bindVariable?: string;
  inputType?: string;
  styles?: Record<string, string | number>;
}

export interface IRImageNode extends IRBaseNode {
  kind: 'IRImage';
  src: IRExpressionNode;
  alt?: IRExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IRFormNode extends IRBaseNode {
  kind: 'IRForm';
  name?: string;
  children: IRUINode[];
  eventHandlers: IREventHandlerNode[];
  styles?: Record<string, string | number>;
}

export interface IRContainerNode extends IRBaseNode {
  kind: 'IRContainer';
  layout?: string;
  direction?: string;
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRCardNode extends IRBaseNode {
  kind: 'IRCard';
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRListNode extends IRBaseNode {
  kind: 'IRList';
  collection?: IRExpressionNode;
  itemVar?: string;
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRLinkNode extends IRBaseNode {
  kind: 'IRLink';
  label: IRExpressionNode;
  target: IRExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IRSelectNode extends IRBaseNode {
  kind: 'IRSelect';
  bindVariable?: string;
  options?: Array<{ label: string; value: string }>;
  styles?: Record<string, string | number>;
}

export interface IRCheckboxNode extends IRBaseNode {
  kind: 'IRCheckbox';
  label?: IRExpressionNode;
  bindVariable?: string;
  styles?: Record<string, string | number>;
}

export interface IRTextareaNode extends IRBaseNode {
  kind: 'IRTextarea';
  placeholder?: IRExpressionNode;
  bindVariable?: string;
  styles?: Record<string, string | number>;
}

export interface IRHeaderNode extends IRBaseNode {
  kind: 'IRHeader';
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRFooterNode extends IRBaseNode {
  kind: 'IRFooter';
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRNavNode extends IRBaseNode {
  kind: 'IRNav';
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRModalNode extends IRBaseNode {
  kind: 'IRModal';
  styles?: Record<string, string | number>;
  children: IRUINode[];
}

export interface IRComponentDeclNode extends IRBaseNode {
  kind: 'IRComponentDecl';
  name: string;
  parameters: string[];
  body: IRInstructionNode[];
}

export interface IRComponentCallNode extends IRBaseNode {
  kind: 'IRComponentCall';
  componentName: string;
  props: Record<string, IRExpressionNode>;
  styles?: Record<string, string | number>;
}

export interface IRRouteNode extends IRBaseNode {
  kind: 'IRRoute';
  path: string;
  targetPage: string;
  pageName?: string;
}

export type IRNode = any;

export interface IRNavigateNode extends IRBaseNode {
  kind: 'IRNavigate';
  target: IRExpressionNode;
}

export interface IRTableNode extends IRBaseNode {
  kind: 'IRTable';
  styles?: Record<string, string | number>;
  children?: IRUINode[];
}

export interface IRDialogNode extends IRBaseNode {
  kind: 'IRDialog';
  title?: IRExpressionNode;
  styles?: Record<string, string | number>;
  children?: IRUINode[];
}

export interface IRTabsNode extends IRBaseNode {
  kind: 'IRTabs';
  styles?: Record<string, string | number>;
  children?: IRUINode[];
}

export interface IRMenuNode extends IRBaseNode {
  kind: 'IRMenu';
  styles?: Record<string, string | number>;
  children?: IRUINode[];
}

export interface IRSidebarNode extends IRBaseNode {
  kind: 'IRSidebar';
  styles?: Record<string, string | number>;
  children?: IRUINode[];
}

export interface IRAvatarNode extends IRBaseNode {
  kind: 'IRAvatar';
  src?: IRExpressionNode;
  fallback?: IRExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IRBadgeNode extends IRBaseNode {
  kind: 'IRBadge';
  text: IRExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IRProgressNode extends IRBaseNode {
  kind: 'IRProgress';
  value: IRExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IRIconNode extends IRBaseNode {
  kind: 'IRIcon';
  name: IRExpressionNode;
  size?: number;
  styles?: Record<string, string | number>;
}

export interface IRVideoNode extends IRBaseNode {
  kind: 'IRVideo';
  src: IRExpressionNode;
  controls?: boolean;
  styles?: Record<string, string | number>;
}

export interface IRAudioNode extends IRBaseNode {
  kind: 'IRAudio';
  src: IRExpressionNode;
  controls?: boolean;
  styles?: Record<string, string | number>;
}

export interface IRCssEscapeNode extends IRBaseNode {
  kind: 'IRCssEscape';
  cssContent: string;
}

export interface IRJsEscapeNode extends IRBaseNode {
  kind: 'IRJsEscape';
  jsContent: string;
}

export interface IRRustEscapeNode extends IRBaseNode {
  kind: 'IRRustEscape';
  rustContent: string;
}

export interface IRLibraryDeclNode extends IRBaseNode {
  kind: 'IRLibraryDecl';
  libraryName: string;
}

export interface IRAnimateNode extends IRBaseNode {
  kind: 'IRAnimate';
  initial?: Record<string, any>;
  to?: Record<string, any>;
  duration?: number;
  ease?: string;
}

export interface IRSolanaProgramNode extends IRBaseNode {
  kind: 'IRSolanaProgram';
  programName: string;
  accounts: any[];
  instructions: any[];
  rawRustEscape?: string;
}

export type IRUINode =
  | IRTextNode
  | IRButtonNode
  | IRInputNode
  | IRImageNode
  | IRFormNode
  | IRContainerNode
  | IRCardNode
  | IRListNode
  | IRLinkNode
  | IRSelectNode
  | IRCheckboxNode
  | IRTextareaNode
  | IRHeaderNode
  | IRFooterNode
  | IRNavNode
  | IRModalNode
  | IRComponentCallNode
  | IRTableNode
  | IRDialogNode
  | IRTabsNode
  | IRMenuNode
  | IRSidebarNode
  | IRAvatarNode
  | IRBadgeNode
  | IRProgressNode
  | IRIconNode
  | IRVideoNode
  | IRAudioNode;

export interface IRPageNode extends IRBaseNode {
  kind: 'IRPage';
  name: string;
  route?: string;
  state: IRStateNode[];
  children: IRUINode[];
  instructions: IRInstructionNode[];
}

export type IRInstructionNode =
  | IRVariableDeclNode
  | IRAssignmentNode
  | IRShowNode
  | IRIfNode
  | IRLoopNode
  | IRForEachNode
  | IRActionDeclNode
  | IRActionCallNode
  | IRReturnNode
  | IREventHandlerNode
  | IRTryCatchNode
  | IRStateNode
  | IRPageNode
  | IRTextNode
  | IRButtonNode
  | IRInputNode
  | IRImageNode
  | IRFormNode
  | IRContainerNode
  | IRCardNode
  | IRListNode
  | IRLinkNode
  | IRSelectNode
  | IRCheckboxNode
  | IRTextareaNode
  | IRHeaderNode
  | IRFooterNode
  | IRNavNode
  | IRModalNode
  | IRComponentDeclNode
  | IRComponentCallNode
  | IRRouteNode
  | IRNavigateNode
  | IRTableNode
  | IRDialogNode
  | IRTabsNode
  | IRMenuNode
  | IRSidebarNode
  | IRAvatarNode
  | IRBadgeNode
  | IRProgressNode
  | IRIconNode
  | IRVideoNode
  | IRAudioNode
  | IRCssEscapeNode
  | IRJsEscapeNode
  | IRRustEscapeNode
  | IRLibraryDeclNode
  | IRAnimateNode
  | IRSolanaProgramNode;

// ----------------------------------------------------
// Scopes & Program
// ----------------------------------------------------

export interface IRScopeSymbol {
  name: string;
  type: 'variable' | 'action' | 'parameter' | 'event';
  sourceLine?: number;
}

export interface IRScope {
  id: string;
  parentScopeId?: string;
  symbols: Map<string, IRScopeSymbol>;
}

export interface IRModuleDeclaration {
  name: string;
  capabilities: string[];
}

export interface IRProgramNode extends IRBaseNode {
  kind: 'IRProgram';
  appName: string;
  capabilities: string[];
  variables: IRVariableDeclNode[];
  actions: IRActionDeclNode[];
  eventHandlers: IREventHandlerNode[];
  instructions: IRInstructionNode[];
  // v0.2 UI & Application extensions
  state?: IRStateNode[];
  pages?: IRPageNode[];
  routes?: IRRouteNode[];
  uiNodes?: IRUINode[];
  solanaProgram?: any;
  sourceFile?: string;
  version: string;
}
