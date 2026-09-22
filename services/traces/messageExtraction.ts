/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Message Extraction Service
 *
 * Transforms OTel spans into a chronological conversation message list.
 * Supports Claude Code telemetry events and generic OTel GenAI conventions.
 */

import { Span, ConversationMessage } from '@/types';
import { parseStructuredMessages } from './messageParts';

/**
 * Extract conversation messages from a flat array of spans.
 *
 * Claude Code emits spans with events: user_prompt, api_request, tool_decision, tool_result.
 * Generic agents use OTel GenAI conventions: llm.request/llm.response events and gen_ai.* attributes.
 */
export function extractMessagesFromSpans(
  spans: Span[],
  serviceName?: string
): ConversationMessage[] {
  if (!spans || spans.length === 0) return [];

  const isClaudeCode = serviceName?.startsWith('claude-code') ||
    spans.some(s => String(s.attributes?.['service.name'] ?? '').startsWith('claude-code')) ||
    spans.some(s => s.name?.startsWith('claude_code.'));

  const sorted = [...spans]
    .filter(s => s.startTime && !isNaN(new Date(s.startTime).getTime()))
    .sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

  const messages: ConversationMessage[] = [];
  // tool_use_ids that already produced a tool_result message from a `tool`
  // span's own `tool.output` event, so the sibling `tool.execution` span
  // (sorted after the call) doesn't push a duplicate result message.
  const resultEmittedForToolUseId = new Set<string>();

  const nativeRootAnswers = new Map(sorted.filter(span =>
    span.attributes?.['agent_health.trace.source'] === 'native-extension' &&
    span.attributes?.['gen_ai.operation.name'] === 'invoke_agent'
  ).map(span => [span.traceId, span.attributes?.['gen_ai.completion']]));
  const nativeChatTraces = new Set(sorted.filter(span => {
    if (span.attributes?.['agent_health.trace.source'] !== 'native-extension' ||
        span.attributes?.['gen_ai.operation.name'] !== 'chat') return false;
    const answer = nativeRootAnswers.get(span.traceId);
    const text = parseStructuredMessages(span.attributes?.['gen_ai.output.messages'])
      .flatMap(message => message.parts).filter(part => part.type === 'text').map(part => part.content);
    // A chat can be truncated more tightly than the root. Only suppress an
    // alias when its complete answer is present, never a longer root answer.
    return typeof answer === 'string' && (text.includes(answer) || text.join('\n') === answer);
  }).map(span => span.traceId));

  for (const span of sorted) {
    if (isClaudeCode) {
      extractClaudeCodeMessages(span, messages, resultEmittedForToolUseId);
    } else {
      const skipCompletion = nativeChatTraces.has(span.traceId) && span.attributes?.['gen_ai.operation.name'] === 'invoke_agent';
      extractGenericMessages(span, messages, skipCompletion);
    }
  }

  // Root completions end after child calls; sort extracted messages, not just spans.
  return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Extract messages from Claude Code span events.
 *
 * Claude Code span hierarchy:
 *   interaction (root) → llm_request / tool → tool.execution
 *
 * Event names: user_prompt, api_request, tool_decision, tool_result
 */
function extractClaudeCodeMessages(
  span: Span,
  messages: ConversationMessage[],
  resultEmittedForToolUseId: Set<string>
): void {
  const events = span.events || [];
  const attrs = span.attributes || {};
  const spanName = span.name?.toLowerCase() || '';

  // User prompt from interaction span attribute (Claude Code stores it directly)
  if (spanName.includes('interaction') && attrs['user_prompt'] && attrs['user_prompt'] !== '<REDACTED>') {
    messages.push({
      id: `${span.spanId}-user-prompt`,
      timestamp: span.startTime,
      role: 'user',
      content: String(attrs['user_prompt']),
      metadata: { spanId: span.spanId, spanName: span.name },
    });
  }

  // User prompt events on interaction spans (legacy path)
  for (const event of events) {
    if (event.name === 'user_prompt') {
      const content = event.attributes?.['user.prompt'] ||
        event.attributes?.['prompt'] ||
        event.attributes?.['content'] || '';
      if (content && !messages.some(m => m.id === `${span.spanId}-user-prompt`)) {
        messages.push({
          id: `${span.spanId}-user-prompt-ev`,
          timestamp: event.time || span.startTime,
          role: 'user',
          content: content || '[User prompt — content not captured. Set OTEL_LOG_USER_PROMPTS=1]',
          metadata: { spanId: span.spanId, spanName: span.name },
        });
      }
    }
  }

  // Tool decision / tool call spans
  if (spanName.includes('tool') && !spanName.includes('execution') && !spanName.includes('blocked')) {
    const toolName = attrs['tool_name'] || attrs['gen_ai.tool.name'] || attrs['tool.name'] || span.name;
    const toolInput = attrs['tool_input'] || attrs['gen_ai.tool.input'] || attrs['full_command'] || '';

    // Check for tool_decision events
    const toolDecisionEvent = events.find(e => e.name === 'tool_decision');
    const input = toolDecisionEvent?.attributes?.['input'] ||
      toolDecisionEvent?.attributes?.['tool.input'] ||
      toolInput;

    if (toolName) {
      messages.push({
        id: `${span.spanId}-tool-call`,
        timestamp: span.startTime,
        role: 'tool_call',
        content: typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input || ''),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          toolName: String(toolName),
          durationMs: span.duration || (new Date(span.endTime).getTime() - new Date(span.startTime).getTime()),
        },
      });
    }

    // tool.output event on the tool span (Claude Code emits output here).
    // Dedup is symmetric with the tool.execution branch below: whichever one
    // is processed first (normally this one, but a sibling tool.execution
    // span could sort first under clock skew) marks the tool_use_id, and the
    // other skips — so a tool call with both result shapes present never
    // produces two tool_result messages regardless of span order.
    const toolOutputEvent = events.find(e => e.name === 'tool.output');
    if (toolOutputEvent) {
      const output = toolOutputEvent.attributes?.['output'] ||
        toolOutputEvent.attributes?.['result'] || '';
      const toolUseId = attrs['tool_use_id'] || attrs['gen_ai.tool.call.id'];
      const alreadyEmitted = toolUseId != null && resultEmittedForToolUseId.has(String(toolUseId));
      if (output && !alreadyEmitted) {
        if (toolUseId) resultEmittedForToolUseId.add(String(toolUseId));
        messages.push({
          id: `${span.spanId}-tool-output-ev`,
          timestamp: toolOutputEvent.time || span.endTime,
          role: 'tool_result',
          content: typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output),
          metadata: {
            spanId: span.spanId,
            spanName: span.name,
            toolName: String(toolName),
          },
        });
      }
    }
  }

  // Tool result events (legacy path)
  for (const event of events) {
    if (event.name === 'tool_result') {
      const content = event.attributes?.['result'] ||
        event.attributes?.['output'] ||
        event.attributes?.['tool.output'] || '';
      messages.push({
        id: `${span.spanId}-tool-result-${event.time}`,
        timestamp: event.time || span.endTime,
        role: 'tool_result',
        content: typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content || '[Tool result — content not captured. Set OTEL_LOG_TOOL_CONTENT=1]'),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          toolName: String(span.attributes?.['tool_name'] || span.attributes?.['gen_ai.tool.name'] || ''),
        },
      });
    }
  }

  // Tool result from tool.execution span attributes (fallback)
  if (spanName.includes('tool.execution') || spanName.includes('tool_execution')) {
    const execToolUseId = attrs['tool_use_id'] || attrs['gen_ai.tool.call.id'];
    const alreadyEmitted = execToolUseId != null && resultEmittedForToolUseId.has(String(execToolUseId));
    const output = attrs['gen_ai.tool.output'] || attrs['tool.output'] || attrs['output'];
    if (output && !alreadyEmitted && !events.some(e => e.name === 'tool_result')) {
      if (execToolUseId != null) resultEmittedForToolUseId.add(String(execToolUseId));
      messages.push({
        id: `${span.spanId}-tool-output`,
        timestamp: span.endTime,
        role: 'tool_result',
        content: typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          toolName: String(attrs['tool_name'] || attrs['gen_ai.tool.name'] || ''),
        },
      });
    }
  }

  // LLM response from llm_request spans
  if (spanName.includes('llm') || spanName.includes('api_request')) {
    const model = attrs['model'] || attrs['gen_ai.request.model'] || '';
    const inputTokens = attrs['input_tokens'] || attrs['gen_ai.usage.input_tokens'];
    const outputTokens = attrs['output_tokens'] || attrs['gen_ai.usage.output_tokens'];

    // Look for api_request or llm.response events for the completion
    const responseEvent = events.find(e =>
      e.name === 'llm.response' || e.name === 'api_response'
    );
    const completion = responseEvent?.attributes?.['llm.completion'] ||
      responseEvent?.attributes?.['completion'] ||
      attrs['gen_ai.completion'] || '';

    if (completion) {
      messages.push({
        id: `${span.spanId}-assistant`,
        timestamp: span.endTime,
        role: 'assistant',
        content: String(completion),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          model: String(model),
          inputTokens: inputTokens ? Number(inputTokens) : undefined,
          outputTokens: outputTokens ? Number(outputTokens) : undefined,
          durationMs: span.duration || (new Date(span.endTime).getTime() - new Date(span.startTime).getTime()),
        },
      });
    }
  }
}

/**
 * Extract messages from generic OTel GenAI spans.
 * Uses standard llm.request/llm.response events and gen_ai.* attributes.
 */
function extractGenericMessages(span: Span, messages: ConversationMessage[], skipCompletion = false): void {
  const events = span.events || [];
  const attrs = span.attributes || {};
  const structuredOutput = !skipCompletion && !attrs['gen_ai.tool.name'] && !attrs['tool.name']
    ? parseStructuredMessages(attrs['gen_ai.output.messages']) : [];
  structuredOutput.forEach((message, index) => {
    messages.push({
      id: `${span.spanId}-output-${index}`,
      timestamp: span.endTime,
      role: message.role === 'user' || message.role === 'system' ? message.role : 'assistant',
      content: message.parts.filter(part => part.type !== 'reasoning').map(part => part.content).join('\n'),
      parts: message.parts,
      metadata: {
        spanId: span.spanId,
        spanName: span.name,
        model: String(attrs['gen_ai.request.model'] || ''),
        // Count usage once even if a provider returns several messages.
        inputTokens: index === 0 && attrs['gen_ai.usage.input_tokens'] != null ? Number(attrs['gen_ai.usage.input_tokens']) : undefined,
        outputTokens: index === 0 && attrs['gen_ai.usage.output_tokens'] != null ? Number(attrs['gen_ai.usage.output_tokens']) : undefined,
        durationMs: span.duration,
      },
    });
  });

  // LLM request event → extract user prompt
  const llmRequest = events.find(e => e.name === 'llm.request');
  if (llmRequest) {
    const prompt = llmRequest.attributes?.['llm.prompt'] ||
      llmRequest.attributes?.['gen_ai.prompt'] ||
      attrs['gen_ai.prompt'];
    if (prompt) {
      messages.push({
        id: `${span.spanId}-prompt`,
        timestamp: span.startTime,
        role: 'user',
        content: typeof prompt === 'object' ? JSON.stringify(prompt, null, 2) : String(prompt),
        metadata: { spanId: span.spanId, spanName: span.name },
      });
    }
  }

  // LLM response event → extract completion
  const llmResponse = events.find(e => e.name === 'llm.response');
  if (llmResponse && !skipCompletion && !structuredOutput.length) {
    const completion = llmResponse.attributes?.['llm.completion'] ||
      attrs['gen_ai.completion'];
    if (completion) {
      messages.push({
        id: `${span.spanId}-completion`,
        timestamp: span.endTime,
        role: 'assistant',
        content: typeof completion === 'object' ? JSON.stringify(completion, null, 2) : String(completion),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          model: String(attrs['gen_ai.request.model'] || ''),
          inputTokens: attrs['gen_ai.usage.input_tokens'] ? Number(attrs['gen_ai.usage.input_tokens']) : undefined,
          outputTokens: attrs['gen_ai.usage.output_tokens'] ? Number(attrs['gen_ai.usage.output_tokens']) : undefined,
          durationMs: span.duration || (new Date(span.endTime).getTime() - new Date(span.startTime).getTime()),
        },
      });
    }
  }

  // Tool spans → tool_call + tool_result.
  // OTel GenAI conveys tool arguments/results three ways (issue #319/#320):
  // spec attributes (gen_ai.tool.call.arguments/.result), span events
  // (gen_ai.tool.message / gen_ai.choice — what Strands emits), and the
  // legacy non-spec attribute names kept as vendor-compat fallbacks.
  const toolName = attrs['gen_ai.tool.name'] || attrs['tool.name'];
  if (toolName) {
    const toolMessageEvent = events.find(e => e.name === 'gen_ai.tool.message');
    const toolChoiceEvent = events.find(e => e.name === 'gen_ai.choice');

    const toolInput = attrs['gen_ai.tool.call.arguments'] ||
      toolMessageEvent?.attributes?.['content'] ||
      attrs['gen_ai.tool.input'] || attrs['input'];
    // Emit the tool_call even when arguments weren't captured — the tool WAS
    // invoked, and the judge needs to see that (issue #320 root cause 2).
    messages.push({
      id: `${span.spanId}-tool-call`,
      timestamp: span.startTime,
      role: 'tool_call',
      content: toolInput
        ? (typeof toolInput === 'object' ? JSON.stringify(toolInput, null, 2) : String(toolInput))
        : '',
      metadata: {
        spanId: span.spanId,
        spanName: span.name,
        toolName: String(toolName),
        durationMs: span.duration || (new Date(span.endTime).getTime() - new Date(span.startTime).getTime()),
      },
    });

    const toolOutput = attrs['gen_ai.tool.call.result'] ||
      toolChoiceEvent?.attributes?.['message'] ||
      toolChoiceEvent?.attributes?.['content'] ||
      attrs['gen_ai.tool.output'] || attrs['output'];
    if (toolOutput) {
      messages.push({
        id: `${span.spanId}-tool-result`,
        timestamp: span.endTime,
        role: 'tool_result',
        content: typeof toolOutput === 'object' ? JSON.stringify(toolOutput, null, 2) : String(toolOutput),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          toolName: String(toolName),
        },
      });
    }
  }

  // Fallback: attributes-only extraction when no events present
  if (events.length === 0 && !toolName) {
    const prompt = attrs['gen_ai.prompt'] || attrs['test.case.input'];
    const completion = !skipCompletion && !structuredOutput.length && (attrs['gen_ai.completion'] || attrs['test.case.output']);

    if (prompt) {
      messages.push({
        id: `${span.spanId}-attr-prompt`,
        timestamp: span.startTime,
        role: 'user',
        content: typeof prompt === 'object' ? JSON.stringify(prompt, null, 2) : String(prompt),
        metadata: { spanId: span.spanId, spanName: span.name },
      });
    }

    if (completion) {
      messages.push({
        id: `${span.spanId}-attr-completion`,
        timestamp: span.endTime,
        role: 'assistant',
        content: typeof completion === 'object' ? JSON.stringify(completion, null, 2) : String(completion),
        metadata: {
          spanId: span.spanId,
          spanName: span.name,
          model: String(attrs['gen_ai.request.model'] || ''),
        },
      });
    }
  }
}
