// ── AI Client — OpenAI + Anthropic streaming chat ─────────────────

export type AIProvider = 'openai' | 'anthropic';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_PROVIDER = 'ai-provider';
const STORAGE_KEY = 'ai-api-key';

export function loadAIConfig(): AIConfig | null {
  try {
    const provider = localStorage.getItem(STORAGE_PROVIDER) as AIProvider | null;
    const apiKey = localStorage.getItem(STORAGE_KEY);
    if (provider && apiKey) return { provider, apiKey };
  } catch {}
  return null;
}

export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_PROVIDER, config.provider);
    localStorage.setItem(STORAGE_KEY, config.apiKey);
  } catch {}
}

export function clearAIConfig(): void {
  try {
    localStorage.removeItem(STORAGE_PROVIDER);
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

const SYSTEM_PROMPT = `You are a helpful writing and thinking assistant embedded in ThoughtStack, a note-taking app.
The user will share their note with you. Help them think through ideas, summarise, expand, rewrite, or answer questions.
Be concise and direct. When producing text meant to be inserted into the note, output only the text with no preamble.`;

// ── OpenAI streaming ───────────────────────────────────────────────

async function* streamOpenAI(
  messages: ChatMessage[],
  noteContext: string,
  apiKey: string,
): AsyncGenerator<string> {
  const payload = {
    model: 'gpt-4o',
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Here is my current note:\n\n---\n${noteContext}\n---\n\nPlease keep this in mind for our conversation.` },
      ...messages,
    ],
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `OpenAI error ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const chunk = JSON.parse(data);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {}
    }
  }
}

// ── Anthropic streaming ────────────────────────────────────────────

async function* streamAnthropic(
  messages: ChatMessage[],
  noteContext: string,
  apiKey: string,
): AsyncGenerator<string> {
  const payload = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `Here is my current note:\n\n---\n${noteContext}\n---\n\nPlease keep this in mind for our conversation.` },
      { role: 'assistant', content: 'Got it! I\'ve read your note. What would you like help with?' },
      ...messages,
    ],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `Anthropic error ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6).trim());
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta.text;
        }
      } catch {}
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────

export async function* streamChat(
  messages: ChatMessage[],
  noteContext: string,
  config: AIConfig,
): AsyncGenerator<string> {
  if (config.provider === 'openai') {
    yield* streamOpenAI(messages, noteContext, config.apiKey);
  } else {
    yield* streamAnthropic(messages, noteContext, config.apiKey);
  }
}
