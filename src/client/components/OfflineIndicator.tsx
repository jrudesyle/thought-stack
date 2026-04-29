import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Offline operation queue ────────────────────────────────────────

const QUEUE_KEY = 'offline-operation-queue';

interface QueuedOperation {
  id: string;
  url: string;
  method: string;
  body?: string;
  timestamp: number;
}

function getQueue(): QueuedOperation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedOperation[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage may be full — silently fail
  }
}

/**
 * Queue a failed API operation for later replay.
 * Called from the API client when a request fails due to network issues.
 */
export function queueOfflineOperation(url: string, method: string, body?: string): void {
  const queue = getQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    method,
    body,
    timestamp: Date.now(),
  });
  saveQueue(queue);
}

/**
 * Replay all queued operations. Called when coming back online.
 * Operations are replayed in order and removed from the queue on success.
 */
async function replayQueue(): Promise<void> {
  const queue = getQueue();
  if (queue.length === 0) return;

  const remaining: QueuedOperation[] = [];

  for (const op of queue) {
    try {
      const init: RequestInit = {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (op.body) init.body = op.body;

      const response = await fetch(op.url, init);
      if (!response.ok && response.status >= 500) {
        // Server error — keep in queue for retry
        remaining.push(op);
      }
      // Success or client error (4xx) — remove from queue
    } catch {
      // Still offline — keep in queue
      remaining.push(op);
    }
  }

  saveQueue(remaining);
}

// ── OfflineIndicator Component ─────────────────────────────────────

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const wasOfflineRef = useRef(isOffline);

  const handleOnline = useCallback(() => {
    setIsOffline(false);
    // Replay queued operations when coming back online
    if (wasOfflineRef.current) {
      replayQueue().catch(() => {
        // Replay failed — operations stay queued for next attempt
      });
    }
    wasOfflineRef.current = false;
  }, []);

  const handleOffline = useCallback(() => {
    setIsOffline(true);
    wasOfflineRef.current = true;
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  if (!isOffline) return null;

  return (
    <div className="offline-indicator" role="status" aria-live="polite">
      <span className="offline-dot" />
      <span>Offline</span>
    </div>
  );
}
