FROM oven/bun:1.2.20
WORKDIR /app
COPY . .
RUN bun tests/account-model-boundary.cjs && bun tests/password-reset-security.mjs && bun tests/early-stop-contract.cjs && bun tests/continuation-compat-contract.cjs && bun run build-bridge.ts && bun run feature-stop.ts && bun run gantt-details.ts && bun run order-accordion.ts && bun run auth-bridge.ts && bun run ceramics-resource-repair.ts && bun run restart-optimizer.ts && bun run documents-tab.ts && bun run ga-execution-budget.ts && bun run tenant-model-build.ts && bun run ga-worker-build.ts && bun run ga-workers-enable.ts && PP_WORKER_TEST=1 bun tests/ga-process-workers.cjs && bun test tests/python-ga-upstream.test.mjs tests/python-ga-state.test.mjs && bun run python-ga-upstream-build.ts && bun run language-build.ts && bun build ./index.ts --target=bun --outdir=/tmp/pp-check
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "index.ts"]
