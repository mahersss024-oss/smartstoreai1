import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

childProcess.spawn = (_command, args) => {
  console.log(JSON.stringify({ args }));
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', 0));
  return child;
};
syncBuiltinESMExports();
