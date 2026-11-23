import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const executables = {
  git: { setting: 'SMARTSTORE_GIT_EXECUTABLE', windowsPath: 'Git/cmd/git.exe' },
  k6: { setting: 'SMARTSTORE_K6_EXECUTABLE', windowsPath: 'k6/k6.exe' },
};

export function localExecutable(name) {
  const { setting, windowsPath } = executables[name];
  const configured = process.env[setting];
  if (configured && !isAbsolute(configured)) {
    throw new Error(`${setting} must be an absolute executable path.`);
  }
  const directories = process.platform === 'win32'
    ? [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  const relativePath = process.platform === 'win32' ? windowsPath : name;
  const candidates = configured
    ? [configured]
    : directories.filter(directory => directory && isAbsolute(directory)).map(directory => join(directory, relativePath));

  for (const candidate of candidates) {
    try {
      const executable = realpathSync(candidate);
      accessSync(executable, constants.X_OK);
      if (statSync(executable).isFile()) return executable;
    } catch {
      // Other standard installation directories may still contain the tool.
    }
  }

  throw new Error(`Could not find ${name} in a standard installation directory. Set ${setting} to its absolute executable path.`);
}
