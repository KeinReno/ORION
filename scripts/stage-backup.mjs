#!/usr/bin/env node
/**
 * Stage a raw backup into a sanitized copy ready for restoration.
 * Called from orion-runtime restore command.
 * 
 * Usage: node scripts/stage-backup.mjs <source-dir> <destination-dir>
 */

import { stageSanitizedMigration } from '../apps/api/src/ops/migration-stage.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This draft does not establish private Windows ACLs or complete the
// credential policy. It must not create a copy of user data yet.
function refuseUnfinishedStage() { throw new Error('stage_backup_not_ready'); }
refuseUnfinishedStage();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure we're in the repo root
process.chdir(path.join(__dirname, '..'));

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node scripts/stage-backup.mjs <source-dir> <destination-dir>');
    process.exit(1);
}

const sourceDir = args[0];
const destinationDir = args[1];

async function main() {
    console.log(`Staging migration from ${sourceDir} to ${destinationDir}`);
    
    const report = await stageSanitizedMigration(sourceDir, destinationDir);
    
    console.log(JSON.stringify({
        status: 'success',
        tablesRewritten: report.tablesRewritten,
        credentialsRotated: report.credentialsRotated,
        exchangesPaused: report.exchangesPaused,
        sideEffectsStopped: report.sideEffectsStopped
    }, null, 2));
}

main().catch((error) => {
    console.error('Staging failed:', error.message);
    process.exit(1);
});
