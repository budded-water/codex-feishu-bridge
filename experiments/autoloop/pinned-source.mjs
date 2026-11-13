import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';

// Shared only by explicit experiments; never installs or updates upstream source.
export function pinnedSource(directory) {
  assert.ok(directory, 'Supply a separate clean pinned Autoloop checkout');
  const source = realpathSync(directory);
  const pin = JSON.parse(readFileSync(new URL('./source.json', import.meta.url), 'utf8'));
  const git = args => {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Autoloop must be a verified Git checkout');
    return result.stdout.trim();
  };
  assert.equal(git(['rev-parse', 'HEAD']), pin.commit, 'Autoloop checkout does not match reviewed pin');
  assert.equal(git(['status', '--porcelain']), '', 'Autoloop checkout must be clean, including untracked files');
  assert.equal(git(['remote', 'get-url', 'origin']).replace(/\.git$/, ''), pin.repository.replace(/\.git$/, ''));
  return source;
}
