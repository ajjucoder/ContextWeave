export const functionDeclarations = `
(function_definition
  name: (name) @name) @definition
`;

export const arrowFunctions = `
(expression_statement
  (assignment_expression
    left: (variable_name) @name
    right: (arrow_function) @value)) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (name) @name) @definition

(interface_declaration
  name: (name) @name) @definition

(trait_declaration
  name: (name) @name) @definition

(enum_declaration
  name: (name) @name) @definition

(namespace_definition
  name: (namespace_name) @name) @definition
`;

export const methodDefinitions = `
(class_declaration
  body: (declaration_list
    (method_declaration
      name: (name) @name) @definition))
`;

export const variableDeclarations = `
(const_declaration
  (const_element
    name: (name) @name
    value: (_) @value)) @definition

(property_declaration
  (property_element
    (variable_name) @name)) @definition

(expression_statement
  (assignment_expression
    left: (variable_name) @name
    right: (_) @value)) @definition
`;

export const importDeclarations = `
(namespace_use_declaration
  (namespace_use_clause) @source @name) @definition
`;

export const exportDeclarations = `
(class_declaration
  name: (name) @name) @definition
`;

export const callExpressions = `
(function_call_expression
  function: (name) @callee) @call

(function_call_expression
  function: (qualified_name) @callee) @call

(member_call_expression
  name: (name) @callee) @call

(scoped_call_expression
  name: (name) @callee) @call

(nullsafe_member_call_expression
  name: (name) @callee) @call
`;

export const interfaceDeclarations = `
(interface_declaration
  name: (name) @name) @definition
`;

export const enumDeclarations = `
(enum_declaration
  name: (name) @name) @definition
`;
