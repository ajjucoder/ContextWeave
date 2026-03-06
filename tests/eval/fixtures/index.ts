import { CONTEXTWEAVE_FIXTURE } from "./contextweave.js";
import { SMALL_PROJECT_FIXTURE } from "./small-project.js";
import type { EvalCodebaseFixture } from "./types.js";

export const EVAL_CODEBASE_FIXTURES: EvalCodebaseFixture[] = [
  CONTEXTWEAVE_FIXTURE,
  SMALL_PROJECT_FIXTURE,
];

export type {
  EvalCodebaseFixture,
  EvalQueryFixture,
  EvalTaskAttemptFixture,
  EvalTaskFixture,
} from "./types.js";
