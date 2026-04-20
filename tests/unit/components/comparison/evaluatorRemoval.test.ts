/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Source-code analysis tests for evaluator UI removal from ComparisonPage.tsx.
 *
 * These tests verify that evaluator-specific UI elements have been removed
 * from the comparison page source code. Since ComparisonPage requires routing,
 * async storage, and other runtime dependencies that make full React rendering
 * impractical in a unit test context, we verify the file contents directly.
 *
 * Validates: Requirements 1.2, 1.4
 */
describe('ComparisonPage evaluator UI removal', () => {
  const filePath = path.resolve(
    __dirname,
    '../../../../components/comparison/ComparisonPage.tsx'
  );
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(filePath, 'utf-8');
  });

  it('should not contain ALL_EVALUATORS variable declaration', () => {
    expect(source).not.toMatch(/\bALL_EVALUATORS\b/);
  });

  it('should not contain evalPopoverOpen state', () => {
    expect(source).not.toMatch(/\bevalPopoverOpen\b/);
  });

  it('should not contain evaluatorsWithData memo', () => {
    expect(source).not.toMatch(/\bevaluatorsWithData\b/);
  });

  it('should not import Eye from lucide-react', () => {
    // Match Eye as a named import token inside a lucide-react import statement
    const lucideImportRegex = /import\s+\{[^}]*\bEye\b[^}]*\}\s+from\s+['"]lucide-react['"]/;
    expect(source).not.toMatch(lucideImportRegex);
  });

  it('should not pass visibleEvaluators prop to child components', () => {
    expect(source).not.toMatch(/visibleEvaluators=\{visibleEvaluators\}/);
  });

  it('should not contain evaluator checkbox UI elements', () => {
    // Look for checkbox inputs that would be part of evaluator toggle UI
    expect(source).not.toMatch(/type=["']checkbox["']/);
  });

  it('should not contain "Evaluators (" popover trigger text', () => {
    expect(source).not.toMatch(/Evaluators\s*\(/);
  });
});
