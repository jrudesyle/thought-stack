// ── AI Client — OpenAI + Anthropic + OpenClaw streaming chat ──────

export type AIProvider = 'openai' | 'anthropic' | 'openclaw';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  /** OpenClaw: base URL of the OpenAI-compatible endpoint, e.g. http://192.168.1.5:11434/v1 */
  endpointUrl?: string;
  /** OpenClaw: model name to request, e.g. llama3, mistral */
  model?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_PROVIDER    = 'ai-provider';
const STORAGE_KEY         = 'ai-api-key';
const STORAGE_ENDPOINT    = 'ai-endpoint-url';
const STORAGE_MODEL       = 'ai-model';

export function loadAIConfig(): AIConfig | null {
  try {
    const provider = localStorage.getItem(STORAGE_PROVIDER) as AIProvider | null;
    if (!provider) return null;
    const apiKey      = localStorage.getItem(STORAGE_KEY) ?? '';
    const endpointUrl = localStorage.getItem(STORAGE_ENDPOINT) ?? undefined;
    const model       = localStorage.getItem(STORAGE_MODEL) ?? undefined;
    // openclaw doesn't require an API key
    if (provider === 'openclaw' && endpointUrl) return { provider, apiKey, endpointUrl, model };
    if (apiKey) return { provider, apiKey, endpointUrl, model };
  } catch {}
  return null;
}

export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_PROVIDER, config.provider);
    localStorage.setItem(STORAGE_KEY, config.apiKey);
    if (config.endpointUrl) localStorage.setItem(STORAGE_ENDPOINT, config.endpointUrl);
    else localStorage.removeItem(STORAGE_ENDPOINT);
    if (config.model) localStorage.setItem(STORAGE_MODEL, config.model);
    else localStorage.removeItem(STORAGE_MODEL);
  } catch {}
}

export function clearAIConfig(): void {
  try {
    [STORAGE_PROVIDER, STORAGE_KEY, STORAGE_ENDPOINT, STORAGE_MODEL].forEach(k =>
      localStorage.removeItem(k));
  } catch {}
}

const SYSTEM_PROMPT = `You are a helpful writing and thinking assistant embedded in ThoughtStack, a note-taking app.
The user will share their note with you. Help them think through ideas, summarise, expand, rewrite, or answer questions.
Be concise and direct. When producing text meant to be inserted into the note, output only the text with no preamble.`;

// ── OpenAI-compatible streaming (used by OpenAI + OpenClaw) ───────

async function* streamOpenAICompat(
  messages: ChatMessage[],
  noteContext: string,
  url: string,
  apiKey: string,
  model: string,
): AsyncGenerator<string> {
  const payload = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Here is my current note:\n\n---\n${noteContext}\n---\n\nPlease keep this in mind for our conversation.` },
      ...messages,
    ],
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `API error ${res.status}`);
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

// ── OpenClaw (OpenAI-compatible) streaming ─────────────────────────

async function* streamOpenClaw(
  messages: ChatMessage[],
  noteContext: string,
  endpointUrl: string,
  apiKey: string,
  model?: string,
): AsyncGenerator<string> {
  const base = endpointUrl.replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  yield* streamOpenAICompat(messages, noteContext, url, apiKey, model ?? 'openclaw');
}

// ── Public API ─────────────────────────────────────────────────────

export type AiIntent = 'replace' | 'append' | 'question';

/** Classify a /ai instruction into replace, append, or question. */
export function classifyAiInstruction(instruction: string): AiIntent {
  const lower = instruction.toLowerCase().trim();
  if (lower.endsWith('?')) return 'question';
  const questionStarters = ['what ', 'how ', 'why ', 'when ', 'where ', 'who ', 'is ', 'are ',
    'can ', 'does ', 'will ', 'should ', 'would ', 'could ', 'do ', 'did ', 'explain '];
  if (questionStarters.some(s => lower.startsWith(s))) return 'question';
  const appendWords = ['add ', 'append', 'insert', 'write a new', 'create a new',
    'new paragraph', 'new section', 'below', 'after this', 'at the end'];
  if (appendWords.some(w => lower.includes(w))) return 'append';
  return 'replace';
}

export async function* streamChat(
  messages: ChatMessage[],
  noteContext: string,
  config: AIConfig,
): AsyncGenerator<string> {
  if (config.provider === 'openai') {
    yield* streamOpenAICompat(messages, noteContext, 'https://api.openai.com/v1/chat/completions', config.apiKey, 'gpt-4o');
  } else if (config.provider === 'openclaw') {
    if (!config.endpointUrl) throw new Error('OpenClaw endpoint URL not configured');
    yield* streamOpenClaw(messages, noteContext, config.endpointUrl, config.apiKey, config.model);
  } else {
    yield* streamAnthropic(messages, noteContext, config.apiKey);
  }
}
