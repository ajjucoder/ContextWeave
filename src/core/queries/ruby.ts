export const functionDeclarations = `
(method
  name: (identifier) @name) @definition

(singleton_method
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(assignment
  left: (identifier) @name
  right: (lambda) @value) @definition
`;

export const classDeclarations = `
(class
  name: (constant) @name) @definition

(module
  name: (constant) @name) @definition

(singleton_class
  value: (_) @name) @definition
`;

export const methodDefinitions = `
(class
  body: (body_statement
    (method
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(assignment
  left: (identifier) @name
  right: (_) @value) @definition

(assignment
  left: (constant) @name
  right: (_) @value) @definition
`;

export const importDeclarations = `
(call
  method: (identifier) @_method
  arguments: (argument_list
    (string
      (string_content) @source @name))
  (#eq? @_method "require")) @definition

(call
  method: (identifier) @_method
  arguments: (argument_list
    (string
      (string_content) @source @name))
  (#eq? @_method "require_relative")) @definition
`;

export const exportDeclarations = `
(call
  method: (identifier) @_method
  arguments: (argument_list
    (constant) @name)
  (#eq? @_method "include")) @definition
`;

export const callExpressions = `
(call
  method: (identifier) @callee) @call

(call
  receiver: (_)
  method: (identifier) @callee) @call
`;
