export const functionDeclarations = `
(method_declaration
  name: (identifier) @name) @definition

(constructor_declaration
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(local_variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (lambda_expression) @value)) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (identifier) @name) @definition

(interface_declaration
  name: (identifier) @name) @definition

(enum_declaration
  name: (identifier) @name) @definition

(record_declaration
  name: (identifier) @name) @definition

(annotation_type_declaration
  name: (identifier) @name) @definition
`;

export const methodDefinitions = `
(class_body
  (method_declaration
    name: (identifier) @name) @definition)
`;

export const variableDeclarations = `
(field_declaration
  (variable_declarator
    name: (identifier) @name
    value: (_) @value)) @definition

(field_declaration
  (variable_declarator
    name: (identifier) @name)) @definition

(constant_declaration
  (variable_declarator
    name: (identifier) @name)) @definition
`;

export const importDeclarations = `
(import_declaration
  (scoped_identifier) @source @name) @definition
`;

export const exportDeclarations = `
(class_declaration
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(method_invocation
  name: (identifier) @callee) @call

(object_creation_expression
  type: (type_identifier) @callee) @call
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
(marker_annotation
  name: (identifier) @decorator_name) @decorator

(annotation
  name: (identifier) @decorator_name) @decorator
`;
