export const functionDeclarations = `
(function_item
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(let_declaration
  pattern: (identifier) @name
  value: (closure_expression) @value) @definition
`;

export const classDeclarations = `
(struct_item
  name: (type_identifier) @name) @definition

(enum_item
  name: (type_identifier) @name) @definition

(trait_item
  name: (type_identifier) @name) @definition

(impl_item
  type: (type_identifier) @name) @definition

(union_item
  name: (type_identifier) @name) @definition
`;

export const methodDefinitions = `
(impl_item
  body: (declaration_list
    (function_item
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(let_declaration
  pattern: (identifier) @name
  value: (_) @value) @definition

(const_item
  name: (identifier) @name
  value: (_) @value) @definition

(static_item
  name: (identifier) @name
  value: (_) @value) @definition
`;

export const importDeclarations = `
(use_declaration
  argument: (identifier) @source @name) @definition

(use_declaration
  argument: (scoped_identifier
    name: (identifier) @name) @source) @definition

(use_declaration
  argument: (use_as_clause
    path: (_) @source
    alias: (identifier) @name)) @definition
`;

export const exportDeclarations = `
(function_item
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (field_expression
    field: (field_identifier) @callee)) @call

(call_expression
  function: (scoped_identifier
    name: (identifier) @callee)) @call

(macro_invocation
  macro: (identifier) @callee) @call
`;

export const decoratorQueries = `
(attribute_item
  (attribute
    (identifier) @decorator_name)) @decorator

(attribute_item
  (attribute
    (scoped_identifier
      name: (identifier) @decorator_name))) @decorator
`;
