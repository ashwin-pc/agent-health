/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
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
    const connector = new SubprocessConnector({
      command: process.execPath,
      args: ['-e', "process.stdout.write(process.env.TREATMENT_VALUE + ':' + require('fs').readFileSync('nested/value.txt','utf8'))"],
      inputMode: 'stdin', outputParser: 'text', workingDir: dir,
    });
    const request = {
      testCase, modelId: 'model',
      overlays: { files: { 'nested/value.txt': 'file' }, env: { TREATMENT_VALUE: 'env' }, skills: ['design-doc'] },
    } as any;
    const environment = await connector.describeEnvironment(request);
    const response = await connector.execute('', request, { type: 'none' });
    expect(readFileSync(join(dir, 'nested/value.txt'), 'utf8')).toBe('file');
    expect(response.trajectory.some(step => step.content.includes('env:file'))).toBe(true);
    expect(environment).toMatchObject({ skills: ['design-doc'], overlaysApplied: { files: ['nested/value.txt'], env: ['TREATMENT_VALUE'] } });
  });

  it('rejects file traversal outside the fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ah-treatment-'));
    dirs.push(dir);
    const connector = new SubprocessConnector({ command: 'true', inputMode: 'stdin', outputParser: 'text', workingDir: dir });
    await expect(connector.execute('', { testCase, modelId: 'm', overlays: { files: { '../escape': 'no' } } } as any, { type: 'none' }))
      .rejects.toThrow('escapes workspace');
  });
});
