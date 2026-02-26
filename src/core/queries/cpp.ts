export const functionDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition

(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier
      name: (identifier) @name))) @definition
`;

export const arrowFunctions = `
(declaration
  (init_declarator
    declarator: (identifier) @name
    value: (lambda_expression) @value)) @definition
`;

export const classDeclarations = `
(class_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(struct_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(enum_specifier
  name: (type_identifier) @name
  body: (enumerator_list)) @definition

(namespace_definition
  name: (namespace_identifier) @name) @definition
`;

export const methodDefinitions = `
(class_specifier
  body: (field_declaration_list
    (function_definition
      declarator: (function_declarator
        declarator: (field_identifier) @name)) @definition))
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

(using_declaration
  (qualified_identifier) @source @name) @definition
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

(call_expression
  function: (qualified_identifier
    name: (identifier) @callee)) @call

(call_expression
  function: (template_function
    name: (identifier) @callee)) @call
`;
