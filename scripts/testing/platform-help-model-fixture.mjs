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
  if (instructions.includes('[hamad:plan]')) {
    return { role: 'assistant', content: JSON.stringify({ action: 'help', topics: ['listings'] }) };
  }
  if (instructions.includes('[hamad:source-check]')) {
    return { role: 'assistant', content: '{"allow":true}' };
  }
  if (!instructions.includes('[hamad:reply]') || request.tools?.length) {
    throw new Error('The platform-help fixture only accepts the structured help dialogue.');
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
