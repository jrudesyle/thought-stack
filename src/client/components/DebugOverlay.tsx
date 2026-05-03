import React, { useState, useEffect, useRef } from 'react';

interface DebugOverlayProps {
  vaultReady: boolean;
  vaultChecked: boolean;
  needsUnlock: boolean;
  vaultPath: string;
  refreshKey: number;
  dataChangeKey: number;
}

interface LogEntry {
  t: string;
  msg: string;
}

// Module-level log buffer shared with the rest of the app
const _log: LogEntry[] = [];
export function debugLog(msg: string) {
  const t = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  _log.unshift({ t, msg });
  if (_log.length > 30) _log.pop();
}

export function DebugOverlay({ vaultReady, vaultChecked, needsUnlock, vaultPath, refreshKey, dataChangeKey }: DebugOverlayProps) {
  const [minimized, setMinimized] = useState(false);
  const [fsaPermission, setFsaPermission] = useState<string>('—');
  const [renderCount, setRenderCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect environment
  const env = (() => {
    if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') return 'Tauri';
    if (typeof (window as any).electronAPI !== 'undefined') return 'Electron';
    if (typeof (window as any).showDirectoryPicker === 'function') return 'FSA/PWA';
    return 'HTTP/Server';
  })();

  // Poll FSA permission every 2s
  useEffect(() => {
    const poll = async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('thought-stack-vault', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const getReq = store.get('vault');
        const handle: FileSystemDirectoryHandle | undefined = await new Promise(res => {
          getReq.onsuccess = () => res(getReq.result);
          getReq.onerror = () => res(undefined);
        });
        db.close();
        if (handle && typeof (handle as any).queryPermission === 'function') {
          const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
          setFsaPermission(perm);
        } else {
          setFsaPermission(handle ? 'no-queryPermission' : 'no-handle');
        }
      } catch (e: any) {
        setFsaPermission(`err: ${e?.message?.slice(0, 30) ?? 'unknown'}`);
      }

      // Refresh log
      setLog([..._log]);
      setRenderCount(c => c + 1);
    };

    poll();
    timerRef.current = setInterval(poll, 2000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const permColor = fsaPermission === 'granted' ? '#4caf50' : fsaPermission === 'prompt' ? '#ff9800' : '#f44336';

  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        style={{
          position: 'fixed', bottom: 8, right: 8, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 20,
          padding: '4px 10px', fontSize: 11, cursor: 'pointer', userSelect: 'none',
        }}
      >
        🐛 {vaultReady ? '✅' : needsUnlock ? '🔒' : '❌'}
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: 8, right: 8, zIndex: 9999,
      background: 'rgba(0,0,0,0.88)', color: '#e0e0e0',
      borderRadius: 8, padding: '8px 10px', fontSize: 11,
      fontFamily: 'monospace', maxWidth: 300, width: '90vw',
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(4px)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>🐛 Debug</span>
        <button
          onClick={() => setMinimized(true)}
          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
        >
          ─
        </button>
      </div>

      {/* Rows */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <Row label="env" value={env} />
          <Row label="vault" value={vaultReady ? '✅ ready' : needsUnlock ? '🔒 needs unlock' : vaultChecked ? '❌ not set' : '⏳ checking'} />
          <Row label="path" value={vaultPath ? vaultPath.split('/').slice(-2).join('/') : '—'} />
          <Row label="fsa-perm" value={fsaPermission} color={permColor} />
          <Row label="refreshKey" value={String(refreshKey)} />
          <Row label="dataKey" value={String(dataChangeKey)} />
          <Row label="polls" value={String(renderCount)} />
        </tbody>
      </table>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid #333', paddingTop: 4, maxHeight: 100, overflowY: 'auto' }}>
          {log.slice(0, 8).map((e, i) => (
            <div key={i} style={{ fontSize: 10, color: '#bbb', lineHeight: 1.4 }}>
              <span style={{ color: '#666' }}>{e.t}</span> {e.msg}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 6, textAlign: 'right' }}>
        <button
          onClick={() => { _log.length = 0; setLog([]); }}
          style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 3, padding: '1px 6px', fontSize: 10, cursor: 'pointer' }}
        >
          clear log
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <tr>
      <td style={{ color: '#888', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ color: color ?? '#e0e0e0', wordBreak: 'break-all' }}>{value}</td>
    </tr>
  );
}
