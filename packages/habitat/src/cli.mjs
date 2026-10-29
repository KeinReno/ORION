#!/usr/bin/env node
import { loadConfig, probeProfiles, runApprovedProfile, saveReceipt } from './habitat.mjs';

function opts(argv) {
  const parsed = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw Error(`Unknown argument: ${key}`);
    if (key === '--acknowledge-local-execution') { parsed.acknowledged = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${key}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

try {
  const args = opts(process.argv.slice(2));
  if (!['probe', 'run'].includes(args.command) || !args.config) {
    throw Error('Usage: habitat probe --config /path/config.json | habitat run --config /path/config.json --profile NAME --workdir DIR --task-file FILE --acknowledge-local-execution');
  }
  const config = await loadConfig(args.config);
  if (args.command === 'probe') {
    console.log(JSON.stringify(await probeProfiles(config), null, 2));
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
