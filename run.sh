#!/bin/sh
set -eu
cd /app
exec bun run audit.ts
