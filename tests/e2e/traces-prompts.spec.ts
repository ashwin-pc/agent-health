/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { test, expect } from './fixtures/test-fixtures';

for (const width of [1440, 375]) {
  test(`trace list keeps prompts and copyable ids readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const prompt = 'List the files in src/services and summarize what each does. ' + 'Explain their responsibilities carefully. '.repeat(7);
    const startTime = new Date(Date.now() - 60000).toISOString();
    const spans = [
      { traceId: 'prompt-regression', spanId: 'root', name: 'invoke_agent', startTime, endTime: startTime, attributes: { 'gen_ai.prompt': prompt } },
      { traceId: 'fallback-regression', spanId: 'root', name: 'invoke_agent', startTime, endTime: startTime, attributes: { 'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Fallback user prompt' }] }]) } },
      { traceId: 'missing-regression', spanId: 'root', name: 'legacy-root', startTime, endTime: startTime, attributes: {} },
    ];
    await page.route('**/api/traces', route => route.fulfill({ json: {
      spans, total: spans.length, hasMore: false,
      traces: [{ traceId: 'prompt-regression', rootSpanName: 'invoke_agent', prompt: prompt.slice(0, 199) + '…' }],
    } }));
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => { (window as any).__copiedTraceId = text; } },
    }));
    await page.goto('/agent-traces');
    const row = page.locator('tbody tr').filter({ hasText: 'prompt-r…' });
    const preview = row.getByTestId('trace-prompt-cell').locator('span');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('title', prompt);
    await expect(preview).toHaveText(prompt.slice(0, 199) + '…');
    await expect(row.getByText('prompt-r…', { exact: true })).toBeVisible();
    if (width === 1440) {
      await expect(page.getByRole('columnheader', { name: 'Trace ID', exact: true })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Prompt', exact: true })).toBeVisible();
      await row.hover();
    }
    await row.getByRole('button', { name: 'Copy trace ID' }).click();
    expect(await page.evaluate(() => (window as any).__copiedTraceId)).toBe('prompt-regression');
    await expect(page.getByText('Fallback user prompt', { exact: true })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'legacy-root' }).getByTestId('trace-prompt-cell')).toHaveText('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 375) {
      const bounds = await preview.evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
      expect(bounds.height).toBeLessThanOrEqual(bounds.lineHeight * 2 + 1);
      expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  });
}
