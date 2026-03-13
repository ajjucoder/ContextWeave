import { defineConfig } from "vitest/config";

const sharedTestConfig = {
  globals: true,
  testTimeout: 30000,
};

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: [],
    projects: [
      {
        test: {
          ...sharedTestConfig,
          name: "default",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/threshold-ratchet.test.ts"],
          sequence: {
            groupOrder: 0,
          },
        },
      },
      {
        test: {
          ...sharedTestConfig,
          name: "ratchet",
          include: ["tests/integration/threshold-ratchet.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          sequence: {
            groupOrder: 1,
          },
        },
      },
    ],
  },
});
