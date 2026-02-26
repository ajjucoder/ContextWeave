export const functionDeclarations = `
(function_definition
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(expression_statement
  (assignment
    left: (identifier) @name
    right: (lambda) @value)) @definition
`;

export const classDeclarations = `
(class_definition
  name: (identifier) @name) @definition
`;

export const methodDefinitions = `
(class_definition
  body: (block
    (function_definition
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(expression_statement
  (assignment
    left: (identifier) @name
    right: (_) @value)) @definition
`;

export const importDeclarations = `
(import_from_statement
  module_name: (dotted_name) @source
  name: (dotted_name
    (identifier) @name)) @definition

(import_from_statement
  module_name: (dotted_name) @source
  name: (aliased_import
    name: (dotted_name
      (identifier) @name))) @definition

(import_from_statement
  module_name: (relative_import) @source
  name: (dotted_name
    (identifier) @name)) @definition

(import_from_statement
  module_name: (relative_import) @source
  name: (aliased_import
    name: (dotted_name
      (identifier) @name))) @definition

(import_statement
  name: (dotted_name) @source @name) @definition

(import_statement
  name: (aliased_import
    name: (dotted_name) @source
    alias: (identifier) @name)) @definition
`;

export const exportDeclarations = `
(module
  (expression_statement
    (assignment
      left: (identifier) @name))) @definition
`;

export const callExpressions = `
(call
  function: (identifier) @callee) @call

(call
  function: (attribute
    attribute: (identifier) @callee)) @call
`;
