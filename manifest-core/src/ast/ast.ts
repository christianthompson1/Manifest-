export interface ASTNode {
  type: string;
  line: number;
  column: number;
}

export interface AppDeclarationNode extends ASTNode {
  type: 'AppDeclaration';
  name: string;
  appName?: string;
  body: StatementNode[];
  statements?: StatementNode[];
  capabilities?: string[];
}

export type StatementNode =
  | WhenBlockNode
  | SetStatementNode
  | ShowStatementNode
  | CallStatementNode
  | ActionDefinitionNode
  | IfStatementNode
  | RepeatLoopNode
  | ForEachLoopNode
  | TryBlockNode
  | UseStatementNode
  | PageDeclarationNode
  | TextNode
  | ButtonNode
  | StateDeclarationNode
  | InputNode
  | FormNode
  | RouteDeclarationNode
  | ContainerNode
  | CardNode
  | ListNode
  | LinkNode
  | SelectNode
  | CheckboxNode
  | TextareaNode
  | HeaderNode
  | NavNode
  | FooterNode
  | ComponentDeclarationNode
  | SolanaProgramNode
  | CssEscapeNode
  | JsEscapeNode
  | ProgressNode
  | BadgeNode
  | IconNode
  | ImageNode
  | ModalNode
  | any;

export interface WhenBlockNode extends ASTNode {
  type: 'WhenBlock';
  event: string;
  body: StatementNode[];
}

export interface SetStatementNode extends ASTNode {
  type: 'SetStatement';
  variable: string;
  value: ExpressionNode;
}

export interface ShowStatementNode extends ASTNode {
  type: 'ShowStatement';
  expression: ExpressionNode;
}

export interface CallStatementNode extends ASTNode {
  type: 'CallStatement';
  actionName: string;
  args: ExpressionNode[];
}

export interface ActionDefinitionNode extends ASTNode {
  type: 'ActionDefinition';
  name: string;
  params: string[];
  returnType?: string;
  body: StatementNode[];
}

export interface ReturnStatementNode extends ASTNode {
  type: 'ReturnStatement';
  expression: ExpressionNode;
}

export interface IfStatementNode extends ASTNode {
  type: 'IfStatement';
  condition: ExpressionNode;
  thenBranch: StatementNode[];
  elseBranch?: StatementNode[];
}

export interface RepeatLoopNode extends ASTNode {
  type: 'RepeatLoop';
  count: ExpressionNode;
  body: StatementNode[];
}

export interface ForEachLoopNode extends ASTNode {
  type: 'ForEachLoop';
  iterator: string;
  iterable: ExpressionNode;
  body: StatementNode[];
}

export interface TryBlockNode extends ASTNode {
  type: 'TryBlock';
  body: StatementNode[];
  catchBranch?: StatementNode[];
}

export interface UseStatementNode extends ASTNode {
  type: 'UseStatement';
  capability: string;
}

// v0.2 Primitives
export interface PageDeclarationNode extends ASTNode {
  type: 'PageDeclaration';
  name: string;
  route?: string;
  body: StatementNode[];
}

export interface ProgressNode extends ASTNode {
  type: 'Progress';
  value: ExpressionNode;
  styles?: Record<string, string>;
}

export interface BadgeNode extends ASTNode {
  type: 'Badge';
  text?: ExpressionNode;
  label?: ExpressionNode;
  styles?: Record<string, string>;
}

export interface IconNode extends ASTNode {
  type: 'Icon';
  name: ExpressionNode;
  size?: number;
  styles?: Record<string, string>;
}

export interface ImageNode extends ASTNode {
  type: 'Image';
  src: ExpressionNode;
  alt?: ExpressionNode;
  styles?: Record<string, string>;
}

export interface ModalNode extends ASTNode {
  type: 'Modal';
  title?: ExpressionNode;
  isOpen?: ExpressionNode;
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface TextNode extends ASTNode {
  type: 'Text';
  content: ExpressionNode;
  styles?: Record<string, string>;
}

export interface ButtonNode extends ASTNode {
  type: 'Button';
  label: ExpressionNode;
  onClick?: StatementNode[];
  styles?: Record<string, string>;
}

export interface StateDeclarationNode extends ASTNode {
  type: 'StateDeclaration';
  name: string;
  dataType?: string;
  initialValue: ExpressionNode;
}

export interface InputNode extends ASTNode {
  type: 'Input';
  placeholder?: string;
  bindVariable?: string;
  styles?: Record<string, string>;
}

export interface FormNode extends ASTNode {
  type: 'Form';
  onSubmit?: StatementNode[];
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface RouteDeclarationNode extends ASTNode {
  type: 'RouteDeclaration';
  path: string;
  pageName: string;
}

// v0.3 UI Primitives
export interface ContainerNode extends ASTNode {
  type: 'Container';
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface CardNode extends ASTNode {
  type: 'Card';
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface ListNode extends ASTNode {
  type: 'List';
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface LinkNode extends ASTNode {
  type: 'Link';
  label: string;
  href: string;
  styles?: Record<string, string>;
}

export interface SelectNode extends ASTNode {
  type: 'Select';
  bindVariable?: string;
  options: Array<{ value: string; label: string }>;
  styles?: Record<string, string>;
}

export interface CheckboxNode extends ASTNode {
  type: 'Checkbox';
  bindVariable?: string;
  label?: string;
  styles?: Record<string, string>;
}

export interface TextareaNode extends ASTNode {
  type: 'Textarea';
  bindVariable?: string;
  placeholder?: string;
  styles?: Record<string, string>;
}

export interface HeaderNode extends ASTNode {
  type: 'Header';
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface NavNode extends ASTNode {
  type: 'Nav';
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface FooterNode extends ASTNode {
  type: 'Footer';
  children: StatementNode[];
  styles?: Record<string, string>;
}

export interface ComponentDeclarationNode extends ASTNode {
  type: 'ComponentDeclaration';
  name: string;
  children: StatementNode[];
}

// v0.4 Solana & Escape Hatches
export interface SolanaProgramNode extends ASTNode {
  type: 'SolanaProgram';
  name: string;
  accounts: Array<{
    name: string;
    fields: Array<{ name: string; fieldType: string }>;
  }>;
  instructions: Array<{
    name: string;
    accounts: Array<{ name: string; isMut: boolean; isSigner: boolean; accountType?: string }>;
    requires: string[];
    mutations: Array<{ target: string; expression: string }>;
    cpis: any[];
    rawRust?: string;
  }>;
}

export interface CssEscapeNode extends ASTNode {
  type: 'CssEscape';
  css: string;
}

export interface JsEscapeNode extends ASTNode {
  type: 'JsEscape';
  code: string;
}

// Expressions
export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | ArrayLiteralNode;

export interface LiteralNode extends ASTNode {
  type: 'Literal';
  value: any;
  raw: string;
}

export interface IdentifierNode extends ASTNode {
  type: 'Identifier';
  name: string;
}

export interface BinaryExpressionNode extends ASTNode {
  type: 'BinaryExpression';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpressionNode extends ASTNode {
  type: 'UnaryExpression';
  operator: string;
  argument: ExpressionNode;
}

export interface ArrayLiteralNode extends ASTNode {
  type: 'ArrayLiteral';
  elements: ExpressionNode[];
}

export type ProgramNode = AppDeclarationNode;
export type VariableReferenceNode = ASTNode & { name: string };
export type CallExpressionNode = ASTNode & { actionName: string; args: ExpressionNode[] };
export type IndexAccessNode = ASTNode & { target: ExpressionNode; index: ExpressionNode };
export type WhenStatementNode = WhenBlockNode & { eventName: string };
export type RepeatStatementNode = RepeatLoopNode;
export type ForEachStatementNode = ForEachLoopNode;
export type ActionDeclarationNode = ActionDefinitionNode;
export type TryStatementNode = TryBlockNode & { tryBlock: StatementNode[]; catchBlock?: StatementNode[] };
export type ComponentCallNode = ASTNode & { componentName: string; props: Record<string, any> };

