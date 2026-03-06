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

(pair
  key: (property_identifier) @name
  value: (arrow_function) @value) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (type_identifier) @name) @definition

(abstract_class_declaration
  name: (type_identifier) @name) @definition
`;

export const methodDefinitions = `
(method_definition
  name: (property_identifier) @name) @definition
`;

export const interfaceDeclarations = `
(interface_declaration
  name: (type_identifier) @name) @definition
`;

export const typeAliasDeclarations = `
(type_alias_declaration
  name: (type_identifier) @name) @definition
`;

export const enumDeclarations = `
(enum_declaration
  name: (identifier) @name) @definition
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

export const reExportDeclarations = `
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @name))
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

export const typeReferences = `
(type_annotation
  (type_identifier) @name) @reference

(type_annotation
  (generic_type
    name: (type_identifier) @name)) @reference
`;

export const classHeritage = `
(class_declaration
  (class_heritage
    (extends_clause
      value: (identifier) @extends))) @definition

(class_declaration
  (class_heritage
    (implements_clause
      (type_identifier) @implements))) @definition

(abstract_class_declaration
  (class_heritage
    (extends_clause
      value: (identifier) @extends))) @definition

(abstract_class_declaration
  (class_heritage
    (implements_clause
      (type_identifier) @implements))) @definition
`;

export const jsxUsages = `
(jsx_opening_element
  name: (identifier) @component) @jsx

(jsx_self_closing_element
  name: (identifier) @component) @jsx

(jsx_attribute
  (property_identifier) @prop_name
  (jsx_expression
    (identifier) @prop_value)) @jsx_prop
`;
