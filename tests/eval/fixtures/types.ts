export interface EvalQueryFixture {
  id: string;
  query: string;
  tokenBudget?: number;
  expectedFiles: string[];
  expectedSymbols?: string[];
}

export interface EvalTaskAttemptFixture extends EvalQueryFixture {}

export interface EvalTaskFixture {
  id: string;
  goal: string;
  attempts: EvalTaskAttemptFixture[];
}

export interface EvalCodebaseFixture {
  id: string;
  label: string;
  root: string;
  defaultTokenBudget: number;
  queries: EvalQueryFixture[];
  tasks?: EvalTaskFixture[];
}
