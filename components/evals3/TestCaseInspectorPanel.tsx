/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * TestCaseInspectorPanel — Right panel for test case inspection
 *
 * Minimal header: test case name + pass/fail status
 * Then tabs: Summary | Conversation | Traces | LLM Judge | Annotations
 */

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EvaluationReport, TestCase } from '@/types';
import { RunDetailsContent } from '../RunDetailsContent';

type ResultStatus = 'passed' | 'failed' | 'running' | 'pending';

interface TestCaseInspectorPanelProps {
  report: EvaluationReport;
  testCase: TestCase | null;
  status: ResultStatus;
}

export const TestCaseInspectorPanel: React.FC<TestCaseInspectorPanelProps> = ({
  report,
  testCase,
  status,
}) => {
  const isPassed = status === 'passed' || report.passFailStatus === 'passed';
  const isFailed = status === 'failed' || report.passFailStatus === 'failed';
  const displayStatus = isFailed ? 'failed' : isPassed ? 'passed' : status;

  return (
    <div className="h-full flex flex-col">
      {/* Compact header — just name + status */}
      <div className="px-4 py-2.5 border-b bg-card shrink-0">
        <div className="flex items-center gap-2">
          {displayStatus === 'passed'
            ? <CheckCircle2 size={16} className="text-green-500 shrink-0" />
            : <XCircle size={16} className="text-red-500 shrink-0" />}
          <span className="text-sm font-semibold truncate flex-1">{testCase?.name || report.testCaseId}</span>
          <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${
            displayStatus === 'passed'
              ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/30'
              : 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30'
          }`}>
            {displayStatus === 'passed' ? 'PASSED' : 'FAILED'}
          </Badge>
        </div>
      </div>

      {/* Tabs — directly into content, no extra chrome */}
      <div className="flex-1 overflow-hidden">
        <RunDetailsContent report={report} hideMetrics />
      </div>
    </div>
  );
};
