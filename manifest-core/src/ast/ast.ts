/**
 * Manifest Core v0.1 - Abstract Syntax Tree (AST) Definitions
 * Clean, structured representation of Manifest code.
 */

export interface AstNode {
  type: string;
  line: number;
  column?: number;
}

// ----------------------------------------------------
// Expressions
// ----------------------------------------------------

export interface LiteralNode extends AstNode {
  type: 'Literal';
  value: string | number | boolean | null;
  raw: string;
}

export interface ArrayLiteralNode extends AstNode {
  type: 'ArrayLiteral';
  elements: ExpressionNode[];
}

export interface VariableReferenceNode extends AstNode {
  type: 'VariableReference';
  name: string;
}

export interface BinaryExpressionNode extends AstNode {
  type: 'BinaryExpression';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpressionNode extends AstNode {
  type: 'UnaryExpression';
  operator: string;
  argument: ExpressionNode;
}

export interface CallExpressionNode extends AstNode {
  type: 'CallExpression';
  actionName: string;
  args: ExpressionNode[];
}

export interface IndexAccessNode extends AstNode {
  type: 'IndexAccess';
  target: ExpressionNode;
  index: ExpressionNode;
}

export type ExpressionNode =
  | LiteralNode
  | ArrayLiteralNode
  | VariableReferenceNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | CallExpressionNode
  | IndexAccessNode;

// ----------------------------------------------------
// Statements
// ----------------------------------------------------

export interface AppDeclarationNode extends AstNode {
  type: 'AppDeclaration';
  name: string;
}

export interface UseDeclarationNode extends AstNode {
  type: 'UseDeclaration';
  capability: string;
}

export interface SetStatementNode extends AstNode {
  type: 'SetStatement';
  variable: string;
  value: ExpressionNode;
}

export interface ShowStatementNode extends AstNode {
  type: 'ShowStatement';
  expression: ExpressionNode;
}

export interface ElseIfBranch {
  condition: ExpressionNode;
  body: StatementNode[];
  line: number;
}

export interface IfStatementNode extends AstNode {
  type: 'IfStatement';
  condition: ExpressionNode;
  consequent: StatementNode[];
  elseIfBranches?: ElseIfBranch[];
  alternate?: StatementNode[];
}

export interface WhenStatementNode extends AstNode {
  type: 'WhenStatement';
  eventName: string;
  body: StatementNode[];
}

export interface RepeatStatementNode extends AstNode {
  type: 'RepeatStatement';
  count: ExpressionNode;
  body: StatementNode[];
}

export interface ForEachStatementNode extends AstNode {
  type: 'ForEachStatement';
  itemVar: string;
  collection: ExpressionNode;
  body: StatementNode[];
}

export interface ActionDeclarationNode extends AstNode {
  type: 'ActionDeclaration';
  name: string;
  params: string[];
  body: StatementNode[];
}

export interface CallStatementNode extends AstNode {
  type: 'CallStatement';
  actionName: string;
  args: ExpressionNode[];
}

export interface ReturnStatementNode extends AstNode {
  type: 'ReturnStatement';
  value?: ExpressionNode;
}

export interface TryStatementNode extends AstNode {
  type: 'TryStatement';
  tryBlock: StatementNode[];
  catchBlock: StatementNode[];
}

// ----------------------------------------------------
// Manifest v0.2 Application Primitive AST Nodes
// ----------------------------------------------------

export interface StateDeclarationNode extends AstNode {
  type: 'StateDeclaration';
  variable: string;
  dataType?: string;
  value: ExpressionNode;
}

export interface PageDeclarationNode extends AstNode {
  type: 'PageDeclaration';
  name: string;
  route?: string;
  body: StatementNode[];
}

export interface TextNode extends AstNode {
  type: 'Text';
  expression: ExpressionNode;
  styles?: Record<string, string | number>;
}

export interface ButtonNode extends AstNode {
  type: 'Button';
  label: ExpressionNode;
  eventHandlers: WhenStatementNode[];
  styles?: Record<string, string | number>;
  animation?: Record<string, any>;
}

export interface InputNode extends AstNode {
  type: 'Input';
  placeholder?: ExpressionNode;
  targetVariable?: string;
  inputType?: string;
  styles?: Record<string, string | number>;
}

export interface ImageNode extends AstNode {
  type: 'Image';
  src: ExpressionNode;
  alt?: ExpressionNode;
  styles?: Record<string, string | number>;
}

export interface FormNode extends AstNode {
  type: 'Form';
  name?: string;
  body: StatementNode[];
  eventHandlers: WhenStatementNode[];
  styles?: Record<string, string | number>;
}

export interface ContainerNode extends AstNode {
  type: 'Container';
  layout?: string;
  direction?: string;
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface CardNode extends AstNode {
  type: 'Card';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface ListNode extends AstNode {
  type: 'List';
  collection?: ExpressionNode;
  itemVar?: string;
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface LinkNode extends AstNode {
  type: 'Link';
  label: ExpressionNode;
  target: ExpressionNode;
  styles?: Record<string, string | number>;
}

export interface SelectNode extends AstNode {
  type: 'Select';
  bindVariable?: string;
  options?: Array<{ label: string; value: string }>;
  styles?: Record<string, string | number>;
}

export interface CheckboxNode extends AstNode {
  type: 'Checkbox';
  label?: ExpressionNode;
  bindVariable?: string;
  styles?: Record<string, string | number>;
}

export interface TextareaNode extends AstNode {
  type: 'Textarea';
  placeholder?: ExpressionNode;
  bindVariable?: string;
  styles?: Record<string, string | number>;
}

export interface TableNode extends AstNode {
  type: 'Table';
  headers?: string[];
  rows?: StatementNode[][];
  styles?: Record<string, string | number>;
  children?: StatementNode[];
}

export interface DialogNode extends AstNode {
  type: 'Dialog';
  title?: ExpressionNode;
  openVariable?: string;
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface TabsNode extends AstNode {
  type: 'Tabs';
  tabs?: string[];
  activeVariable?: string;
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface MenuNode extends AstNode {
  type: 'Menu';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface SidebarNode extends AstNode {
  type: 'Sidebar';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface AvatarNode extends AstNode {
  type: 'Avatar';
  src?: ExpressionNode;
  fallback?: ExpressionNode;
  styles?: Record<string, string | number>;
}

export interface BadgeNode extends AstNode {
  type: 'Badge';
  text: ExpressionNode;
  variant?: string;
  styles?: Record<string, string | number>;
}

export interface ProgressNode extends AstNode {
  type: 'Progress';
  value: ExpressionNode;
  max?: ExpressionNode;
  styles?: Record<string, string | number>;
}

export interface IconNode extends AstNode {
  type: 'Icon';
  name: ExpressionNode;
  size?: number;
  styles?: Record<string, string | number>;
}

export interface VideoNode extends AstNode {
  type: 'Video';
  src: ExpressionNode;
  autoplay?: boolean;
  controls?: boolean;
  styles?: Record<string, string | number>;
}

export interface AudioNode extends AstNode {
  type: 'Audio';
  src: ExpressionNode;
  controls?: boolean;
  styles?: Record<string, string | number>;
}

// ----------------------------------------------------
// Escape Hatch Nodes
// ----------------------------------------------------

export interface CssEscapeNode extends AstNode {
  type: 'CssEscape';
  cssContent: string;
}

export interface JsEscapeNode extends AstNode {
  type: 'JsEscape';
  jsContent: string;
}

export interface RustEscapeNode extends AstNode {
  type: 'RustEscape';
  rustContent: string;
}

// ----------------------------------------------------
// Library & Animation Nodes
// ----------------------------------------------------

export interface LibraryDeclarationNode extends AstNode {
  type: 'LibraryDeclaration';
  libraryName: string;
  options?: Record<string, any>;
}

export interface AnimateNode extends AstNode {
  type: 'Animate';
  initial?: Record<string, any>;
  to?: Record<string, any>;
  duration?: number;
  ease?: string;
}

// ----------------------------------------------------
// Solana AST Nodes
// ----------------------------------------------------

export interface ProgramDeclarationNode extends AstNode {
  type: 'ProgramDeclaration';
  name: string;
  body: StatementNode[];
}

export interface AccountField {
  name: string;
  fieldType: string;
  isSigner?: boolean;
}

export interface AccountDeclarationNode extends AstNode {
  type: 'AccountDeclaration';
  name: string;
  fields: AccountField[];
}

export interface InstructionDeclarationNode extends AstNode {
  type: 'InstructionDeclaration';
  name: string;
  body: StatementNode[];
}

export interface RequireNode extends AstNode {
  type: 'Require';
  condition: ExpressionNode;
  errorMessage?: string;
}

export interface CpiCallNode extends AstNode {
  type: 'CpiCall';
  programName: string;
  methodName: string;
  args: Record<string, ExpressionNode>;
}

export interface HeaderNode extends AstNode {
  type: 'Header';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface FooterNode extends AstNode {
  type: 'Footer';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface NavNode extends AstNode {
  type: 'Nav';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface ModalNode extends AstNode {
  type: 'Modal';
  styles?: Record<string, string | number>;
  children: StatementNode[];
}

export interface ComponentDeclarationNode extends AstNode {
  type: 'ComponentDeclaration';
  name: string;
  params: string[];
  body: StatementNode[];
}

export interface ComponentCallNode extends AstNode {
  type: 'ComponentCall';
  name: string;
  props: Record<string, ExpressionNode>;
  styles?: Record<string, string | number>;
}

export interface RouteDeclarationNode extends AstNode {
  type: 'RouteDeclaration';
  path: string;
  targetPage: string;
}

export type StatementNode =
  | AppDeclarationNode
  | UseDeclarationNode
  | SetStatementNode
  | ShowStatementNode
  | IfStatementNode
  | WhenStatementNode
  | RepeatStatementNode
  | ForEachStatementNode
  | ActionDeclarationNode
  | CallStatementNode
  | ReturnStatementNode
  | TryStatementNode
  | StateDeclarationNode
  | PageDeclarationNode
  | TextNode
  | ButtonNode
  | InputNode
  | ImageNode
  | FormNode
  | ContainerNode
  | CardNode
  | ListNode
  | LinkNode
  | SelectNode
  | CheckboxNode
  | TextareaNode
  | TableNode
  | DialogNode
  | TabsNode
  | MenuNode
  | SidebarNode
  | AvatarNode
  | BadgeNode
  | ProgressNode
  | IconNode
  | VideoNode
  | AudioNode
  | CssEscapeNode
  | JsEscapeNode
  | RustEscapeNode
  | LibraryDeclarationNode
  | AnimateNode
  | ProgramDeclarationNode
  | AccountDeclarationNode
  | InstructionDeclarationNode
  | RequireNode
  | CpiCallNode
  | HeaderNode
  | FooterNode
  | NavNode
  | ModalNode
  | ComponentDeclarationNode
  | ComponentCallNode
  | RouteDeclarationNode;

// ----------------------------------------------------
// Program Root Node
// ----------------------------------------------------

export interface ProgramNode extends AstNode {
  type: 'Program';
  appName?: string;
  capabilities: string[];
  statements: StatementNode[];
}
