#!/usr/bin/env node

import { checkSupabaseReadiness } from "../lib/supabase-readiness.mjs";

const result = await checkSupabaseReadiness();
if (!result.checked) {
  console.error("Shared storage readiness could not run. Configure SUPABASE_URL and the server-only Supabase secret first.");
  process.exitCode = 1;
} else if (!result.provisioned) {
  console.error(`Shared storage is not ready: ${result.missingResourceCount} required table or singleton row check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("Shared storage is ready: all required tables and singleton rows are available.");
}
