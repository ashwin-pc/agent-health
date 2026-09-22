/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from './fixtures/test-fixtures';

test('trace tree names bare tools without duplicating authored names or decorating chat', async ({ page }) => {
  const t0 = Date.now() - 60000;
  const base = {
    traceId: 'tool-label-regression', startTime: new Date(t0).toISOString(),
    endTime: new Date(t0 + 1000).toISOString(), duration: 1000, status: 'OK',
  };
  const spans = [
    { ...base, spanId: 'root', name: 'invoke_agent: Inspect services', attributes: { 'gen_ai.operation.name': 'invoke_agent' } },
    { ...base, spanId: 'bash', parentSpanId: 'root', name: 'execute_tool', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'bash' } },
    { ...base, spanId: 'read', parentSpanId: 'root', name: 'execute_tool read', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'read' } },
    { ...base, spanId: 'chat', parentSpanId: 'root', name: 'chat', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'anthropic/claude-sonnet-4.5' } },
  ];
  // Network fixtures only: no persisted test data or live trace mutations.
  await page.route('**/api/traces', route => route.fulfill({
    json: { spans, total: spans.length, hasMore: false },
  }));
  await page.goto('/agent-traces');
  await page.locator('tbody tr').filter({ hasText: 'invoke_agent: Inspect services' }).first().locator('td').first().click();
  await expect(page.getByText('execute_tool · bash', { exact: true })).toBeVisible();
  await expect(page.getByText('execute_tool read', { exact: true })).toBeVisible();
  await expect(page.getByText('chat', { exact: true })).toHaveAttribute('title', 'chat');
  await expect(page.getByText('execute_tool read · read', { exact: true })).toHaveCount(0);
});
