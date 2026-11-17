// The pinned ESLint consumers load this adapter synchronously with require().
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { statSync } = require('node:fs');
const { globSync: findPaths, hasMagic } = require('glob');
/* eslint-enable @typescript-eslint/no-require-imports */

// Compatibility for the glob calls in the three pinned ESLint consumers.
const list = value => typeof value === 'string' ? [value] : value ?? [];
const globOptions = { magicalBraces: true, windowsPathsNoEscape: process.platform === 'win32' };
const isDynamicPattern = pattern => pattern.startsWith('!') || hasMagic(pattern, globOptions);

function globSync(input, options = {}) {
  const { cwd = process.cwd(), absolute = false, dot = false, onlyDirectories = false, expandDirectories = true } = options;
  const patterns = list(input);
  const exclusions = [...list(options.ignore), ...patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1))];
  const positives = patterns.filter(pattern => !pattern.startsWith('!'));
  if (!positives.length) return [];

  const isDirectory = value => statSync(path.resolve(cwd, value), { throwIfNoEntry: false })?.isDirectory();
  const searches = positives.map(pattern =>
    !onlyDirectories && expandDirectories && !isDynamicPattern(pattern) && isDirectory(pattern)
      ? `${pattern.replace(/[\\/]$/, '')}/**`
      : pattern);
  const ignore = exclusions.flatMap(pattern =>
    expandDirectories && !pattern.endsWith('*') ? [pattern, `${pattern.replace(/[\\/]$/, '')}/**`] : [pattern]);
  const matches = findPaths(searches, {
    ...globOptions, cwd, absolute, dot, ignore, nodir: !onlyDirectories,
    nocase: options.caseSensitiveMatch === false,
  });
  const results = onlyDirectories ? matches.filter(isDirectory) : matches;
  return process.platform === 'win32' ? results.map(value => value.replaceAll('\\', '/')) : results;
}

module.exports = { globSync, isDynamicPattern };
