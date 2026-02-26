export const functionDeclarations = `
(function_declaration
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(short_var_declaration
  left: (expression_list
    (identifier) @name)
  right: (expression_list
    (func_literal) @value)) @definition
`;

export const classDeclarations = `
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (struct_type))) @definition

(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (interface_type))) @definition
`;

export const methodDefinitions = `
(method_declaration
  name: (field_identifier) @name) @definition
`;

export const variableDeclarations = `
(var_declaration
  (var_spec
    name: (identifier) @name
    value: (expression_list (_) @value))) @definition

(const_declaration
  (const_spec
    name: (identifier) @name
    value: (_) @value)) @definition

(short_var_declaration
  left: (expression_list
    (identifier) @name)
  right: (expression_list
    (_) @value)) @definition
`;

export const importDeclarations = `
(import_spec
  path: (interpreted_string_literal) @source @name) @definition

(import_spec
  name: (package_identifier) @name
  path: (interpreted_string_literal) @source) @definition
`;

export const exportDeclarations = `
(function_declaration
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (selector_expression
    field: (field_identifier) @callee)) @call
`;
