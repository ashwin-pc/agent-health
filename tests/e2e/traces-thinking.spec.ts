/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { test, expect } from './fixtures/test-fixtures';

test('Messages shows thinking collapsed, expands it, and remembers it within the open trace', async ({ page }) => {
  const t0 = Date.now() - 60000;
  const base = { traceId: 'thinking-regression', startTime: new Date(t0).toISOString(), endTime: new Date(t0 + 1000).toISOString(), duration: 1000, status: 'OK' };
  const thinking = 'Compare exponential backoff with linear delays.';
  const spans = [
    { ...base, spanId: 'root', name: 'invoke_agent', attributes: { 'gen_ai.operation.name': 'invoke_agent', 'agent_health.trace.source': 'native-extension', 'gen_ai.prompt': 'Synthetic reasoning regression', 'gen_ai.completion': 'Use jitter.' } },
    { ...base, spanId: 'chat', parentSpanId: 'root', name: 'chat', attributes: {
      'gen_ai.operation.name': 'chat', 'agent_health.trace.source': 'native-extension', 'gen_ai.request.model': 'fixture-model',
      'gen_ai.output.messages': JSON.stringify([{ role: 'assistant', parts: [
        { type: 'reasoning', content: thinking }, { type: 'text', content: 'Use jitter.' }, { type: 'vendor-part', content: 'Unknown still readable' },
      ] }]),
    } },
  ];
  // Network-only synthetic fixtures: never persist or mix these with real traces.
  await page.route('**/api/traces', route => route.fulfill({ json: { spans, total: spans.length, hasMore: false } }));
  await page.goto('/agent-traces');
  await page.locator('tbody tr').filter({ hasText: 'Synthetic reasoning regression' }).first().locator('td').first().click();
  await page.getByTitle('Open fullscreen', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Messages', exact: true }).click();
  const toggle = dialog.getByRole('button', { name: `Thinking Show ${thinking.length} chars` });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByText(thinking, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Use jitter.', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Unknown still readable', { exact: true })).toBeVisible();
  await toggle.click();
  await expect(dialog.getByText(thinking, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Trace tree', exact: true }).click();
  await dialog.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Thinking Hide' })).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByText(thinking, { exact: true })).toBeVisible();
});
