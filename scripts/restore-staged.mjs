#!/usr/bin/env node
/**
 * Restore a staged backup into an isolated PostgreSQL database.
 * Called from orion-runtime restore command.
 * 
 * Usage: node scripts/restore-staged.mjs <staged-dir> <storage-dir> [database-url]
 */

import { readManifest, restoreNodeBackup } from '../apps/api/src/ops/node-backup.js';
import { verifyNodeBackupIntegrity } from '../apps/api/src/ops/backup-integrity.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A checksum-valid copy is not proof that the destination is isolated or that
// all credentials and side effects have been neutralized. Keep this draft
// fail-closed until target ownership, activation and rollback are implemented.
function refuseUnfinishedRestore() { throw new Error('restore_staged_not_ready'); }
refuseUnfinishedRestore();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure we're in the repo root
process.chdir(path.join(__dirname, '..'));

const args = process.argv.slice(2);
if (args.length < 3) {
    console.error('Usage: node restore-staged.mjs <staged-dir> <storage-dir> [database-url]');
    process.exit(1);
}

const stagedDir = args[0];
const storageDir = args[1];
const databaseUrl = args[2] || process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('DATABASE_URL not provided');
    process.exit(1);
}

async function main() {
    console.log(`Restoring staged backup from ${stagedDir}`);
    
    // Verify integrity first
    const integrity = await verifyNodeBackupIntegrity(stagedDir);
    if (integrity.status !== 'integrity-verified') {
        throw new Error(`Backup integrity failed: ${integrity.issues.join(', ')}`);
    }
    
    // Read manifest for verification
    const manifest = await readManifest(stagedDir);
    console.log(`Found ${Object.keys(manifest.tables).length} tables, ${manifest.migrations.length} migrations`);
    
    // Create Prisma client
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    
    try {
        await db.$connect();
        
        // Restore data
        const report = await restoreNodeBackup(db, {
            dir: stagedDir,
            storageDir,
            syncSecret: process.env.SYNC_SECRET
        });
        
        console.log(`Restored: ${report.tables} tables, ${report.rows} rows, ${report.files} files`);
        
        if (report.warnings.length > 0) {
            report.warnings.forEach(w => console.warn(`Warning: ${w}`));
        }
        
        console.log('Restore completed successfully');
    } finally {
        await db.$disconnect();
    }
}

main().catch((error) => {
    console.error('Restore failed:', error.message);
    process.exit(1);
});
