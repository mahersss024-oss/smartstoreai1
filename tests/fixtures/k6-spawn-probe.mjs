import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

childProcess.spawnSync = (command, args) => {
  console.log(JSON.stringify({ command, args }));
  return { status: 0 };
};
syncBuiltinESMExports();
