// Tiny async KV store. IndexedDB in the browser, in-memory (optionally file-backed) elsewhere.
export interface KV {
  get<T = any>(key: string): Promise<T | undefined>;
  set(key: string, val: any): Promise<void>;
  getMany<T = any>(keys: string[]): Promise<(T | undefined)[]>;
  setMany(entries: [string, any][]): Promise<void>;
  clear(): Promise<void>;
}
export class MemoryKV implements KV {
  m = new Map<string, any>();
  async get(k: string) { return this.m.get(k); }
  async set(k: string, v: any) { this.m.set(k, v); }
  async getMany(ks: string[]) { return ks.map(k => this.m.get(k)); }
  async setMany(es: [string, any][]) { for (const [k, v] of es) this.m.set(k, v); }
  async clear() { this.m.clear(); }
}
export class IDBKV implements KV {
  private dbp: Promise<IDBDatabase>;
  constructor(name = 'pulsebasis-cache') {
    this.dbp = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  private async tx(mode: IDBTransactionMode) { const db = await this.dbp; return db.transaction('kv', mode).objectStore('kv'); }
  private req<T>(r: IDBRequest<T>) { return new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async get(k: string) { return this.req((await this.tx('readonly')).get(k)); }
  async set(k: string, v: any) { await this.req((await this.tx('readwrite')).put(v, k)); }
  async getMany(ks: string[]) { const s = await this.tx('readonly'); return Promise.all(ks.map(k => this.req(s.get(k)))); }
  async setMany(es: [string, any][]) {
    if (!es.length) return;
    const db = await this.dbp; const t = db.transaction('kv', 'readwrite'); const s = t.objectStore('kv');
    for (const [k, v] of es) s.put(v, k);
    await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  async clear() { await this.req((await this.tx('readwrite')).clear()); }
}
