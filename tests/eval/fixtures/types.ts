export interface EvalQueryFixture {
  id: string;
  query: string;
  tokenBudget?: number;
  expectedFiles: string[];
  expectedSymbols?: string[];
}

export interface EvalCodebaseFixture {
  id: string;
  label: string;
  root: string;
  defaultTokenBudget: number;
  queries: EvalQueryFixture[];
}
