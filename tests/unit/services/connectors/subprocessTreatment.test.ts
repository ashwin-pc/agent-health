/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SubprocessConnector } from '../../../../services/connectors/subprocess/SubprocessConnector';

const testCase = { id: 'tc', initialPrompt: 'go', context: [] } as any;

describe('SubprocessConnector treatment overlays', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

  it('materializes files, applies env, and reports the resolved environment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ah-treatment-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'fixture.txt'), 'pinned');
    const skills = mkdtempSync(join(tmpdir(), 'ah-skills-'));
    dirs.push(skills);
    mkdirSync(join(skills, 'design-doc'));
    writeFileSync(join(skills, 'design-doc', 'SKILL.md'), '# Design');
    const connector = new SubprocessConnector({
      command: process.execPath,
      args: ['-e', "process.stdout.write(process.env.TREATMENT_VALUE + ':' + require('fs').readFileSync('nested/value.txt','utf8') + ':' + require('fs').existsSync('.agent-health/skills/design-doc/SKILL.md'))"],
      inputMode: 'stdin', outputParser: 'text', workingDir: dir,
    });
    const request = {
      testCase, modelId: 'model', connectorConfig: { skillsDirectory: skills },
      overlays: { files: { 'nested/value.txt': 'file' }, env: { TREATMENT_VALUE: 'env' }, skills: ['design-doc'] },
    } as any;
    const environment = await connector.describeEnvironment(request);
    const response = await connector.execute('', request, { type: 'none' });
    expect(existsSync(join(dir, 'nested/value.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'fixture.txt'), 'utf8')).toBe('pinned');
    expect(response.trajectory.some(step => step.content.includes('env:file:true'))).toBe(true);
    expect(environment).toMatchObject({ skills: ['design-doc'], overlaysApplied: { files: { 'nested/value.txt': expect.stringMatching(/^[a-f0-9]{64}$/) }, env: { TREATMENT_VALUE: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
  });

  it('reports machine-independent identity and content-sensitive overlay hashes', () => {
    const a = new SubprocessConnector({ workingDir: '/tmp/checkout-a' });
    const b = new SubprocessConnector({ workingDir: '/different/checkout-b' });
    const request = { testCase, modelId: 'm', overlays: { files: { 'x': 'one' }, env: { X: 'one' } } } as any;
    expect(a.describeEnvironment(request)).toEqual(b.describeEnvironment(request));
    expect(a.describeEnvironment(request)).not.toEqual(a.describeEnvironment({ ...request, overlays: { files: { x: 'two' }, env: { X: 'one' } } }));
  });

  it('rejects file traversal outside the fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ah-treatment-'));
    dirs.push(dir);
    const connector = new SubprocessConnector({ command: 'true', inputMode: 'stdin', outputParser: 'text', workingDir: dir });
    await expect(connector.execute('', { testCase, modelId: 'm', overlays: { files: { '../escape': 'no' } } } as any, { type: 'none' }))
      .rejects.toThrow('escapes workspace');
  });
});
