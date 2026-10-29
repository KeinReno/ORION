#!/usr/bin/env node
import { loadConfig, probeProfiles, runApprovedProfile, saveReceipt } from './habitat.mjs';
import { runAgentHubExecution } from './agent-hub-bridge.mjs';
import { superviseHabitat, readSupervisorStatus } from './supervisor.mjs';
import { readFile, stat } from 'node:fs/promises';

async function readAgentToken(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 1 || info.size > 4096) throw Error('Invalid token file');
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw Error('Token file readable by other users');
  const token = (await readFile(file, 'utf8')).split(/\r?\n/, 1)[0].trim();
  if (!token.startsWith('orion_agt_')) throw Error('Invalid agent token');
  return token;
}

function opts(argv) {
  const parsed = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw Error(`Unknown argument: ${key}`);
    if (key === '--acknowledge-local-execution') { parsed.acknowledged = true; continue; }
    if (key === '--acknowledge-monitoring') { parsed.monitoringApproved = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${key}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

try {
  const args = opts(process.argv.slice(2));
  if (!['probe', 'run', 'run-hub', 'supervise', 'supervisor-status'].includes(args.command) || !args.config) {
    throw Error('Usage: habitat supervise --config FILE --token-file FILE --acknowledge-monitoring | habitat supervisor-status --config FILE | habitat probe --config FILE | habitat run --config FILE --profile ID --workdir DIR --task-file FILE --acknowledge-local-execution | habitat run-hub --config FILE --token-file FILE --execution-id ID --profile ID --workdir DIR --task-file FILE --acknowledge-local-execution');
  }
  const config = await loadConfig(args.config);
  if (args.command === 'supervisor-status') {
    console.log(JSON.stringify(await readSupervisorStatus(config), null, 2));
  } else if (args.command === 'supervise') {
    if (!args['token-file']) throw Error('Missing --token-file');
    const token = await readAgentToken(args['token-file']);
    const abortController = new AbortController();
    const onStop = () => abortController.abort();
    process.on('SIGINT', onStop);
    process.on('SIGTERM', onStop);
    try {
      const result = await superviseHabitat({
        config, token, apiUrl: args['api-url'] ?? 'http://127.0.0.1:4000',
        acknowledged: args.monitoringApproved, signal: abortController.signal
      });
      console.log(JSON.stringify({ sessionId: result.sessionId, status: result.status, polls: result.polls }, null, 2));
      if (result.status === 'auth_denied') process.exitCode = 1;
    } finally {
      process.off('SIGINT', onStop);
      process.off('SIGTERM', onStop);
    }
  } else if (args.command === 'probe') {
    console.log(JSON.stringify(await probeProfiles(config), null, 2));
  } else if (args.command === 'run-hub') {
    if (!args['token-file'] || !args['execution-id'] || !args.profile || !args.workdir || !args['task-file']) throw Error('Missing --token-file, --execution-id, --profile, --workdir or --task-file');
    const token = await readAgentToken(args['token-file']);
    const result = await runAgentHubExecution({
      config, token, executionId: args['execution-id'], apiUrl: args['api-url'] ?? 'http://127.0.0.1:4000',
      profileId: args.profile, workdir: args.workdir, taskFile: args['task-file'], acknowledged: args.acknowledged
    });
    console.log(JSON.stringify({ execution: result.execution, receipt: result.receipt, receiptFile: result.receiptFile }, null, 2));
    if (result.execution.status !== 'review') process.exitCode = 1;
  } else {
    if (!args.profile || !args.workdir || !args['task-file']) throw Error('Missing --profile, --workdir or --task-file');
    const receipt = await runApprovedProfile({
      config, profileId: args.profile, workdir: args.workdir, taskFile: args['task-file'], acknowledged: args.acknowledged
    });
    const receiptFile = await saveReceipt(config, receipt);
    console.log(JSON.stringify({ ...receipt, receiptFile }, null, 2));
    if (receipt.outcome !== 'exited' || receipt.exitCode !== 0) process.exitCode = 1;
  }
} catch (error) {
  console.error(`KAIDEN Habitat: ${error?.code ?? error?.message ?? 'unknown_error'}`);
  process.exitCode = 1;
}
