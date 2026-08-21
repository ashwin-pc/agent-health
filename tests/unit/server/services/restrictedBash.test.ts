/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseRestrictedCommand, RestrictedBash } from '@/server/services/restrictedBash';

let root: string;
let bash: RestrictedBash;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'restricted-bash-test-'));
  await fs.mkdir(path.join(root, 'evidence', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'scratch'));
  await fs.writeFile(path.join(root, 'evidence', 'words.txt'), 'pear\napple\napple\nBANANA\n');
  await fs.writeFile(path.join(root, 'evidence', 'table.txt'), 'a,3\nb,1\nc,2\n');
  await fs.writeFile(path.join(root, 'evidence', 'nested', 'note.log'), 'before\nneedle\nafter\n');
  await fs.writeFile(path.join(root, 'evidence', 'data.json'), JSON.stringify([
    { type: 'action', toolName: 'read' },
    { type: 'action', toolName: 'read' },
    { type: 'response', content: 'done' },
  ]));
  bash = await RestrictedBash.create({ rootDir: root, quotaBytes: 100, quotaFiles: 2 });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const run = (command: string) => bash.execute(command);

describe('restricted parser', () => {
  it('parses quoted args, pipelines, sequences, and redirects', () => {
    expect(parseRestrictedCommand("grep -i 'hello world' evidence/a | sort && echo ok > scratch/out")).toEqual({
      first: [
        { argv: ['grep', '-i', 'hello world', 'evidence/a'], redirects: [] },
        { argv: ['sort'], redirects: [] },
      ],
      rest: [{ op: '&&', pipeline: [{ argv: ['echo', 'ok'], redirects: [{ kind: '>', path: 'scratch/out' }] }] }],
    });
  });

  it.each([
    ['echo $(id)', /variables|substitution/],
    ['echo `id`', /backticks/],
    ['echo $HOME', /variables/],
    ['(echo x)', /subshell/],
    ['echo x &', /background/],
    ['cat evidence/*.json', /glob expansion/],
    ['echo "unterminated', /unterminated quote/],
  ])('rejects unsupported syntax: %s', (command, message) => {
    expect(() => parseRestrictedCommand(command)).toThrow(message as RegExp);
  });
});

describe('restricted commands — golden behavior', () => {
  it('cat, echo, pwd, redirection and sequences', async () => {
    expect((await run('cat evidence/table.txt')).stdout).toBe('a,3\nb,1\nc,2\n');
    expect((await run('echo hello world')).stdout).toBe('hello world\n');
    expect((await run('pwd')).stdout).toBe(`${root}\n`);
    expect((await run('echo one > scratch/out; echo two >> scratch/out; cat scratch/out')).stdout).toBe('one\ntwo\n');
    expect((await run('wc -l < evidence/words.txt')).stdout).toBe('4\n');
    expect((await run('grep missing evidence/words.txt || echo fallback')).stdout).toBe('fallback\n');
    expect((await run('grep apple evidence/words.txt && echo found')).stdout).toBe('apple\napple\nfound\n');
  });

  it('ls and find (-name/-type/-maxdepth)', async () => {
    const ls = await run('ls evidence');
    expect(ls.stdout).toContain('data.json');
    expect(ls.stdout).toContain('nested/');
    const find = await run("find evidence -maxdepth 2 -type f -name '*.log'");
    expect(find.stdout).toBe('evidence/nested/note.log\n');
  });

  it('grep/rg flags, recursion, context, count, files, fixed and max', async () => {
    expect((await run('grep -in -m 1 apple evidence/words.txt')).stdout).toBe('2:apple\n');
    expect((await run('grep -iv apple evidence/words.txt')).stdout).toContain('pear');
    expect((await run('grep -c apple evidence/words.txt')).stdout).toBe('2\n');
    expect((await run('grep -l needle evidence/nested/note.log')).stdout).toBe('evidence/nested/note.log\n');
    expect((await run('grep -n -C 1 needle evidence/nested/note.log')).stdout).toBe('1:before\n2:needle\n3:after\n');
    expect((await run('grep -F "a,3" evidence/table.txt')).stdout).toBe('a,3\n');
    expect((await run('rg -r needle evidence')).stdout).toContain('evidence/nested/note.log:needle');
  });

  it('head, tail and wc line/byte/word modes', async () => {
    expect((await run('head -n 2 evidence/words.txt')).stdout).toBe('pear\napple\n');
    expect((await run('tail -n 2 evidence/words.txt')).stdout).toBe('apple\nBANANA\n');
    expect((await run('head -c 4 evidence/words.txt')).stdout).toBe('pear');
    expect((await run('tail -c 7 evidence/words.txt')).stdout).toBe('BANANA\n');
    expect((await run('wc -l evidence/words.txt')).stdout).toBe('4 evidence/words.txt\n');
    expect((await run('echo "one two" | wc -w')).stdout).toBe('2\n');
  });

  it('sort and uniq flags', async () => {
    expect((await run('sort evidence/words.txt | uniq -c')).stdout).toContain('      2 apple');
    expect((await run('sort -t , -k 2 -n evidence/table.txt')).stdout).toBe('b,1\nc,2\na,3\n');
    expect((await run('sort -r -u evidence/words.txt')).stdout.split('\n')[0]).toBe('pear');
    expect((await run('sort evidence/words.txt | uniq -d')).stdout).toBe('apple\n');
  });

  it('cut, tr and sed subsets', async () => {
    expect((await run('cut -d , -f 1 evidence/table.txt')).stdout).toBe('a\nb\nc\n');
    expect((await run('echo abc | cut -c 2-3')).stdout).toBe('bc\n');
    expect((await run("echo abc | tr 'a-c' 'A-C'")).stdout).toBe('ABC\n');
    expect((await run("echo banana | tr -d 'a'")).stdout).toBe('bnn\n');
    expect((await run("echo apple apple | sed 's/apple/pear/g'")).stdout).toBe('pear pear\n');
    expect((await run("sed -n 'p' evidence/words.txt")).stderr).toMatch(/only s\/pattern/);
  });

  it('runs real jq-wasm and composes a useful evidence pipeline', async () => {
    const result = await run("jq -r '.[] | select(.type==\"action\") | .toolName' evidence/data.json | sort | uniq -c");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('      2 read\n');
  });
});

describe('confinement and failure semantics', () => {
  it('rejects `cat /etc/passwd` and .. path escapes', async () => {
    expect((await run('cat ../etc/passwd')).stderr).toMatch(/path escape rejected/);
    expect((await run('cat /etc/passwd')).stderr).toMatch(/outside judgment directory/);
  });

  it('rejects symlinks instead of following them', async () => {
    await fs.symlink('/etc/passwd', path.join(root, 'evidence', 'link'));
    expect((await run('cat evidence/link')).stderr).toMatch(/symlinks are not allowed/);
  });

  it('rejects `echo x > evidence/t` and all writes outside scratch', async () => {
    expect((await run('echo x > evidence/t')).stderr).toMatch(/writes are allowed only under scratch/);
    expect((await run(`echo x > ${path.join(root, 'outside')}`)).stderr).toMatch(/writes are allowed only under scratch/);
  });

  it('enforces byte and file quota', async () => {
    expect((await run(`echo ${'x'.repeat(101)} > scratch/large`)).stderr).toMatch(/quota exceeded/);
    await run('echo a > scratch/one');
    await run('echo b > scratch/two');
    expect((await run('echo c > scratch/three')).stderr).toMatch(/quota exceeded/);
  });

  it('enforces the configured per-command timeout', async () => {
    const immediate = await RestrictedBash.create({ rootDir: root, timeoutMs: 0 });
    expect((await immediate.execute('cat evidence/words.txt')).stderr).toMatch(/timed out after 0ms/);
  });

  it('reports unknown commands, cd, and output truncation instructively', async () => {
    expect((await run('python3 -V')).text).toMatch(/python3: command not found.*available: jq|available: cat/);
    expect((await run('cd evidence')).stderr).toMatch(/cwd is fixed/);
    const capped = await RestrictedBash.create({ rootDir: root, outputCapBytes: 80 });
    expect((await capped.execute('cat evidence/words.txt evidence/words.txt evidence/words.txt evidence/words.txt')).text)
      .toMatch(/output truncated.*narrow the query/);
  });

  it('new interpreter modules never import child_process', async () => {
    for (const file of ['restrictedBash.ts', 'evidenceJudgeTools.ts', 'judgeEvidence.ts']) {
      const source = await fs.readFile(path.join(process.cwd(), 'server', 'services', file), 'utf8');
      expect(source).not.toMatch(/(?:node:)?child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfork\s*\(/);
    }
  });
});
