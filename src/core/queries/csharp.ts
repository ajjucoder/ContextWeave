export const functionDeclarations = `
(method_declaration
  name: (identifier) @name) @definition

(constructor_declaration
  name: (identifier) @name) @definition

(local_function_statement
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_expression_clause
      (lambda_expression) @value))) @definition

(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (equals_value_clause
      (lambda_expression) @value))) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (identifier) @name) @definition

(struct_declaration
  name: (identifier) @name) @definition

(interface_declaration
  name: (identifier) @name) @definition

(enum_declaration
  name: (identifier) @name) @definition

(record_declaration
  name: (identifier) @name) @definition

(namespace_declaration
  name: (_) @name) @definition
`;

export const methodDefinitions = `
(class_declaration
  body: (declaration_list
    (method_declaration
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(field_declaration
  (variable_declaration
    (variable_declarator
      name: (identifier) @name))) @definition

(property_declaration
  name: (identifier) @name) @definition

(event_field_declaration
  (variable_declaration
    (variable_declarator
      name: (identifier) @name))) @definition
`;

export const importDeclarations = `
(using_directive
  (identifier) @source @name) @definition

(using_directive
  (qualified_name) @source @name) @definition
`;

export const exportDeclarations = `
(class_declaration
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(invocation_expression
  function: (identifier) @callee) @call

(invocation_expression
  function: (member_access_expression
    name: (identifier) @callee)) @call

(object_creation_expression
  type: (identifier) @callee) @call

(object_creation_expression
  type: (generic_name
    (identifier) @callee)) @call
`;

export const interfaceDeclarations = `
(interface_declaration
  name: (identifier) @name) @definition
`;

export const enumDeclarations = `
(enum_declaration
  name: (identifier) @name) @definition
`;

export const decoratorQueries = `
(attribute_list
  (attribute
    name: (identifier) @decorator_name)) @decorator

(attribute_list
  (attribute
    name: (qualified_name
      name: (identifier) @decorator_name))) @decorator
`;
