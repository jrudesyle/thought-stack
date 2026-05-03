// Injected before page scripts — overrides indexedDB to return fake vault data
(function() {
  function mkFile(content, name) {
    return {
      kind: 'file', name: name,
      getFile: function() { return Promise.resolve(new File([content], name, {type:'text/plain'})); },
      queryPermission: function() { return Promise.resolve('granted'); },
      requestPermission: function() { return Promise.resolve('granted'); },
      createWritable: function() { return Promise.resolve({ write: function() { return Promise.resolve(); }, close: function() { return Promise.resolve(); } }); }
    };
  }
  function mkDir(name, files) {
    var h = {
      kind: 'directory', name: name,
      queryPermission: function() { return Promise.resolve('granted'); },
      requestPermission: function() { return Promise.resolve('granted'); },
      getDirectoryHandle: function(n) { return Promise.resolve(mkDir(n, files)); },
      getFileHandle: function(n, o) {
        if (files[n]) return Promise.resolve(mkFile(files[n], n));
        if (o && o.create) { files[n] = ''; return Promise.resolve(mkFile('', n)); }
        return Promise.reject(new DOMException('nf', 'NotFoundError'));
      },
      entries: function() {
        var es = Object.keys(files).map(function(k) { return [k, mkFile(files[k], k)]; });
        var i = 0;
        return {
          next: function() {
            if (i < es.length) return Promise.resolve({ value: es[i++], done: false });
            return Promise.resolve({ value: undefined, done: true });
          }
        };
      }
    };
    h[Symbol.asyncIterator] = h.entries; // won't work for for-await
    return h;
  }

  var nbFiles = {
    'hello.md': '---\nid: n1\ntags: []\ncreated: 2024-01-01T00:00:00Z\nmodified: 2024-01-01T00:00:00Z\n---\n# Hello World\nTest note content.',
    'second.md': '---\nid: n2\ntags: []\ncreated: 2024-01-02T00:00:00Z\nmodified: 2024-01-02T00:00:00Z\n---\n# Second Note\nAnother note here.'
  };

  function mkRootDir() {
    var nbDir = {
      kind: 'directory', name: 'My Notebook',
      queryPermission: function() { return Promise.resolve('granted'); },
      requestPermission: function() { return Promise.resolve('granted'); },
      getDirectoryHandle: function(n) { return Promise.resolve(mkDir(n, {})); },
      getFileHandle: function(n, o) {
        if (nbFiles[n]) return Promise.resolve(mkFile(nbFiles[n], n));
        if (o && o.create) { nbFiles[n] = ''; return Promise.resolve(mkFile('', n)); }
        return Promise.reject(new DOMException('nf', 'NotFoundError'));
      },
      entries: function() {
        var keys = Object.keys(nbFiles);
        var i = 0;
        var self = this;
        var iter = {
          next: function() {
            if (i < keys.length) {
              var k = keys[i++];
              return Promise.resolve({ value: [k, mkFile(nbFiles[k], k)], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          }
        };
        iter[Symbol.asyncIterator] = function() { return iter; };
        return iter;
      }
    };

    var rootHandle = {
      kind: 'directory', name: 'Vault',
      queryPermission: function() { return Promise.resolve('granted'); },
      requestPermission: function() { return Promise.resolve('granted'); },
      getDirectoryHandle: function(n, o) {
        if (n === 'My Notebook') return Promise.resolve(nbDir);
        return Promise.resolve(mkDir(n, {}));
      },
      getFileHandle: function() { return Promise.reject(new DOMException('nf', 'NotFoundError')); },
      entries: function() {
        var i = 0;
        var entries = [['My Notebook', nbDir]];
        var iter = {
          next: function() {
            if (i < entries.length) return Promise.resolve({ value: entries[i++], done: false });
            return Promise.resolve({ value: undefined, done: true });
          }
        };
        iter[Symbol.asyncIterator] = function() { return iter; };
        return iter;
      }
    };
    return rootHandle;
  }

  var VAULT = mkRootDir();
  var SETTINGS = { vaultPath: 'Vault', theme: 'system', autoSaveDelayMs: 1000, recentVaults: [] };

  var _realIDBOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name, version) {
    if (name !== 'thoughtstack') return _realIDBOpen.call(this, name, version);

    var fakeStore = { vaultHandle: VAULT, settings: SETTINGS };
    var fakeDb = {
      transaction: function(storeName, mode) {
        var tx = {
          oncomplete: null, onerror: null,
          objectStore: function() {
            return {
              get: function(key) {
                var req = { result: undefined, onsuccess: null, onerror: null };
                var val = fakeStore[key];
                setTimeout(function() {
                  req.result = val;
                  if (req.onsuccess) req.onsuccess({ target: req });
                }, 0);
                return req;
              },
              put: function(val, key) {
                fakeStore[key] = val;
                var req = { onsuccess: null };
                setTimeout(function() {
                  if (req.onsuccess) req.onsuccess();
                  if (tx.oncomplete) tx.oncomplete();
                }, 0);
                return req;
              }
            };
          }
        };
        setTimeout(function() { if (tx.oncomplete) tx.oncomplete(); }, 20);
        return tx;
      }
    };

    var req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    setTimeout(function() {
      req.result = fakeDb;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  };

  console.log('[MOCK] IDB override active');
})();
