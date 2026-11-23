import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

childProcess.spawnSync = (command, args, options) => {
  console.log(JSON.stringify({ command, args, shell: Boolean(options?.shell) }));
  return { status: 0 };
};
syncBuiltinESMExports();
