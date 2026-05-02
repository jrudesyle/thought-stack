import React, { useState, useRef, useEffect, useCallback } from 'react';
import { streamChat, loadAIConfig, type ChatMessage } from '../api/ai-client';

interface AiChatProps {
  noteContext: string;
  onInsert: (text: string) => void;
}

export function AiChat({ noteContext, onInsert }: AiChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<boolean>(false);

  const config = loadAIConfig();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !config) return;

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setError(null);
    setStreaming(true);
    abortRef.current = false;

    // Placeholder for streaming response
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      let accumulated = '';
      for await (const chunk of streamChat(newMessages, noteContext, config)) {
        if (abortRef.current) break;
        accumulated += chunk;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: accumulated };
          return updated;
        });
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
      setMessages(prev => prev.slice(0, -1)); // remove empty assistant message
    } finally {
      setStreaming(false);
    }
  }, [input, messages, noteContext, config, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleInsert = (text: string) => {
    onInsert(text);
  };

  const handleClear = () => {
    abortRef.current = true;
    setMessages([]);
    setError(null);
    setStreaming(false);
  };

  if (!config) {
    return (
      <div className="ai-no-config">
        <button
          className="ai-fab"
          title="AI Chat (no API key configured)"
          onClick={() => setOpen(o => !o)}
        >✨</button>
        {open && (
          <div className="ai-panel">
            <div className="ai-panel-header">
              <span>✨ AI Assistant</span>
              <button className="ai-panel-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="ai-no-key-msg">
              <p>Add your API key in <strong>Settings → AI</strong> to enable the assistant.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`ai-container${open ? ' ai-container--open' : ''}`}>
      {/* Floating button */}
      <button
        className={`ai-fab${open ? ' ai-fab--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="AI Assistant"
        aria-label={open ? 'Close AI chat' : 'Open AI chat'}
      >
        ✨
      </button>

      {/* Chat panel */}
      {open && (
        <div className="ai-panel">
          <div className="ai-panel-header">
            <span>✨ AI Assistant <span className="ai-provider-badge">{config.provider === 'openai' ? 'GPT-4o' : 'Claude'}</span></span>
            <div className="ai-panel-actions">
              {messages.length > 0 && (
                <button className="ai-panel-clear" onClick={handleClear} title="Clear chat">🗑</button>
              )}
              <button className="ai-panel-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
          </div>

          <div className="ai-messages">
            {messages.length === 0 && (
              <div className="ai-welcome">
                <p>Ask anything about this note — summarise, expand, rewrite, or brainstorm.</p>
                <div className="ai-suggestions">
                  {['Summarise this note', 'What are the key points?', 'Help me expand this'].map(s => (
                    <button key={s} className="ai-suggestion" onClick={() => { setInput(s); setTimeout(send, 0); }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`ai-message ai-message--${msg.role}`}>
                <div className="ai-message-content">
                  {msg.content || (streaming && i === messages.length - 1 ? <span className="ai-cursor">▋</span> : '')}
                </div>
                {msg.role === 'assistant' && msg.content && !streaming && (
                  <button
                    className="ai-insert-btn"
                    onClick={() => handleInsert(msg.content)}
                    title="Insert into note"
                  >
                    ↩ Insert
                  </button>
                )}
              </div>
            ))}

            {error && (
              <div className="ai-error">⚠ {error}</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-input-row">
            <textarea
              ref={inputRef}
              className="ai-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask AI… (Enter to send, Shift+Enter for newline)"
              rows={2}
              disabled={streaming}
            />
            <button
              className="ai-send-btn"
              onClick={send}
              disabled={!input.trim() || streaming}
              aria-label="Send"
            >
              {streaming ? '⏳' : '↑'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
