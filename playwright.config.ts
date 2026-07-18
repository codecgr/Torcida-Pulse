import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  webServer: [
    {
      command: "MOCK_TODDS_PORT=4311 node tests/helpers/mock-txline-server.mjs",
      port: 4311,
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "NODE_ENV=test TXLINE_API_ORIGIN=http://127.0.0.1:4311 SOLANA_RPC_URL=http://127.0.0.1:8899 TXLINE_GUEST_JWT=e2e-jwt TXLINE_API_TOKEN=txoracle_api_e2e_only REPLAY_RATE_LIMIT_MAX=200 PORT=4310 npx tsx tests/helpers/e2e-app.ts",
      port: 4310,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4310",
    browserName: "chromium",
    viewport: { width: 375, height: 812 },
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
});
