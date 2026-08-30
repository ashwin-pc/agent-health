/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { AgentContextItem } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Markdown } from '@/components/ui/markdown';

interface ContextDispositionGroupsProps {
  items: AgentContextItem[];
  compact?: boolean;
}

function formatContextValue(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

/**
 * Shared, delivery-aware context rendering for definition and detail views.
 * Legacy items without a disposition are delivered to the agent.
 */
export const ContextDispositionGroups: React.FC<ContextDispositionGroupsProps> = ({
  items,
  compact = false,
}) => {
  const delivered = items.filter(item => !item.disposition || item.disposition === 'prompt');
  const directives = items.filter(item => item.disposition === 'connector');
  const documentation = items.filter(item => item.disposition === 'documentation');
  const textClass = compact ? 'text-[10px]' : 'text-xs';
  const headingClass = 'text-[9px] font-semibold text-muted-foreground uppercase tracking-wider';

  return (
    <div className="space-y-3" data-testid="context-disposition-groups">
      <p className={`${textClass} text-muted-foreground`} data-testid="context-delivery-summary">
        Agent receives: prompt + {delivered.length} context items · directives: {directives.length} · documentation: {documentation.length}
      </p>

      {delivered.length > 0 && (
        <div className="space-y-1.5">
          <h4 className={headingClass}>Delivered to agent</h4>
          {delivered.map((item, index) => (
            <div key={index} className="bg-card rounded border border-border px-3 py-2 min-w-0">
              <p className={`${textClass} font-medium text-foreground break-words mb-1`}>
                {item.description || `Context item ${index + 1}`}
              </p>
              <pre className={`${textClass} text-muted-foreground font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-32 overflow-y-auto leading-relaxed`}>
                {formatContextValue(item.value)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {directives.length > 0 && (
        <div className="space-y-1.5">
          <h4 className={headingClass}>Connector directive — not delivered</h4>
          <div className="flex flex-wrap gap-2">
            {directives.map((item, index) => (
              <Badge key={index} variant="outline" className={`${textClass} font-mono max-w-full whitespace-normal break-all`}>
                {item.description}: {item.value}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {documentation.length > 0 && (
        <div className="space-y-1.5">
          <h4 className={headingClass}>Documentation — not delivered</h4>
          {documentation.map((item, index) => (
            <div key={index} className="bg-card rounded border border-border px-3 py-2 min-w-0">
              <p className={`${textClass} font-medium text-muted-foreground break-words mb-2`}>
                {item.description}
              </p>
              <Markdown className={textClass}>{item.value}</Markdown>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
