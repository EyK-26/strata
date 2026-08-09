#!/usr/bin/env bun
import { runCreateStrata } from "./src/generate.ts";

const code = await runCreateStrata(process.argv.slice(2));
process.exit(code);
