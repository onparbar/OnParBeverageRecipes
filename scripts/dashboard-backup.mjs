import { createDashboardBackupJob } from "../lib/dashboard-backup.mjs";
const result = await createDashboardBackupJob()({ includePmb: !process.argv.includes("--storage-only") });
console.log(JSON.stringify(result, null, 2));
if (result.errors?.length) process.exitCode = 1;
