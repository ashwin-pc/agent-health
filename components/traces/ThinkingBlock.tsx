/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type ThinkingState = {
  expanded: Set<string>;
  toggle: (key: string) => void;
};
const ThinkingContext = createContext<ThinkingState | null>(null);

/** Keep disclosure state per span/part for the lifetime of the open trace. */
export const ThinkingStateProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return <ThinkingContext.Provider value={{ expanded, toggle }}>{children}</ThinkingContext.Provider>;
};

export const ThinkingBlock: React.FC<{ content: string; stateKey: string }> = ({ content, stateKey }) => {
  const shared = useContext(ThinkingContext);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = shared ? shared.expanded.has(stateKey) : localExpanded;
  const id = useId();
  return (
    <div className="my-2 rounded-md border border-border bg-muted/30 p-2 text-muted-foreground font-mono">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => shared ? shared.toggle(stateKey) : setLocalExpanded(!localExpanded)}
        className="flex items-center gap-2 text-xs hover:text-foreground"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold">Thinking</span>
        <span>{expanded ? 'Hide' : `Show ${content.length.toLocaleString()} chars`}</span>
      </button>
      {expanded && <pre id={id} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{content || 'No thinking text was emitted by the model.'}</pre>}
    </div>
  );
};
