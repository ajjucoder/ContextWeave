export const functionDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const arrowFunctions = `
(declaration
  (init_declarator
    declarator: (identifier) @name
    value: (compound_literal_expression) @value)) @definition
`;

export const classDeclarations = `
(struct_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(union_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(enum_specifier
  name: (type_identifier) @name
  body: (enumerator_list)) @definition

(type_definition
  declarator: (type_identifier) @name) @definition
`;

export const methodDefinitions = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const variableDeclarations = `
(declaration
  (init_declarator
    declarator: (identifier) @name
    value: (_) @value)) @definition

(declaration
  declarator: (identifier) @name) @definition
`;

export const importDeclarations = `
(preproc_include
  path: (string_literal) @source @name) @definition

(preproc_include
  path: (system_lib_string) @source @name) @definition
`;

export const exportDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (field_expression
    field: (field_identifier) @callee)) @call
`;
