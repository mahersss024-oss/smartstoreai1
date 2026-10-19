function reply(body) {
  const request = JSON.parse(body);
  const instructions = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  if (instructions.includes('Analyze marketplace text once')) {
    const texts = JSON.parse(request.messages.at(-1).content);
    return { role: 'assistant', content: JSON.stringify({ items: texts.map(({ id }) => ({ id, analysis: {
      intent: 'support', category: null, confidence: 0.99, offerKind: 'unknown', aliases: [], search: {},
      compliance: { decision: 'allow', reasons: [], shariaSensitive: false },
    } })) }) };
  }
  if (instructions.includes('Scope Checker')) {
    return { role: 'assistant', content: JSON.stringify({ decision: 'ALLOW', confidence: 0.99, reason_code: 'load_test_platform_help' }) };
  }
  if (request.tools?.some(tool => tool.function.name !== 'getPlatformHelp')) {
    throw new Error('The platform-help fixture must not be offered draft or sensitive-action tools.');
  }
  if (request.tools?.length && !request.messages.some(message => message.role === 'tool')) {
    return { role: 'assistant', content: null, tool_calls: [{ id: 'load-platform-help', type: 'function',
      function: { name: 'getPlatformHelp', arguments: JSON.stringify({ topic: 'listings' }) } }] };
  }
  return { role: 'assistant', content: 'يمكنك اختيار الإنشاء اليدوي أو تجهيز مسودة مع حمد، ثم مراجعتها ونشرها بنفسك من إعلاناتي.' };
}

export function createPlatformHelpCompletion(body, id = 'platform-help-fixture') {
  const message = reply(body);
  return Response.json({ id, object: 'chat.completion', created: 1, model: 'smartstore-test-model',
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
  });
}
