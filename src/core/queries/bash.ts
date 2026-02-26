export const functionDeclarations = `
(function_definition
  name: (word) @name) @definition
`;

export const arrowFunctions = `
(variable_assignment
  name: (variable_name) @name
  value: (_) @value) @definition
`;

export const classDeclarations = `
(function_definition
  name: (word) @name) @definition
`;

export const methodDefinitions = `
(function_definition
  name: (word) @name) @definition
`;

export const variableDeclarations = `
(variable_assignment
  name: (variable_name) @name
  value: (_) @value) @definition

(declaration_command
  (variable_assignment
    name: (variable_name) @name
    value: (_) @value)) @definition
`;

export const importDeclarations = `
(command
  name: (command_name) @_cmd
  argument: (word) @source @name
  (#eq? @_cmd "source")) @definition

(command
  name: (command_name) @_cmd
  argument: (word) @source @name
  (#eq? @_cmd ".")) @definition
`;

export const exportDeclarations = `
(declaration_command
  (variable_assignment
    name: (variable_name) @name)) @definition
`;

export const callExpressions = `
(command
  name: (command_name) @callee) @call
`;
