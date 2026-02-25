export const functionDeclarations = `
(function_declaration
  name: (identifier) @name) @definition

(generator_function_declaration
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function) @value)) @definition

(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function) @value)) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (identifier) @name) @definition
`;

export const methodDefinitions = `
(method_definition
  name: (property_identifier) @name) @definition
`;

export const variableDeclarations = `
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (_) @value)) @definition

(variable_declaration
  (variable_declarator
    name: (identifier) @name)) @definition
`;

export const importDeclarations = `
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @name)))
  source: (string) @source) @definition

(import_statement
  (import_clause
    (identifier) @name)
  source: (string) @source) @definition

(import_statement
  (import_clause
    (namespace_import
      (identifier) @name))
  source: (string) @source) @definition
`;

export const exportDeclarations = `
(export_statement
  declaration: (_) @declaration) @definition

(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @name))) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (member_expression
    property: (property_identifier) @callee)) @call
`;
