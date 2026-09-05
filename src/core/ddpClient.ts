import EventEmitter from 'eventemitter3';

export function generateSubscriptionId(pubName: string, params: any[]): string {
  const serialized = JSON.stringify(params);
  const payload = `${pubName}::${serialized}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
}

export class MeteorDDPClient extends EventEmitter {
  private url: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingCalls = new Map<string, { resolve: (res: any) => void; reject: (err: any) => void }>();
  public collections: Record<string, Record<string, any>> = {};
  public subscriptions: Map<string, { name: string; params: any[] }> = new Map();
  public loginToken: string | null = null;
  private reconnectTimer: any = null;
  private isExplicitClose = false;

  constructor(url = 'wss://ws.btsbots.com/websocket') {
    super();
    this.url = url;
  }

  public isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  public async connect(): Promise<void> {
    if (this.isConnected()) return;
    this.isExplicitClose = false;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.ws?.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
        };

        this.ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const msgType = data.msg;

          if (msgType === 'connected') {
            resolve();
            this.emit('connected');
            this.resumeSubscriptions();
          }

          if (msgType === 'ping') {
            this.ws?.send(JSON.stringify({ msg: 'pong', id: data.id }));
          }

          if (msgType === 'result') {
            const callId = data.id;
            if (this.pendingCalls.has(callId)) {
              const { resolve: pResolve, reject: pReject } = this.pendingCalls.get(callId)!;
              this.pendingCalls.delete(callId);
              if (data.error) {
                pReject(new Error(data.error.reason || 'DDP RPC Error'));
              } else {
                pResolve(data.result);
              }
            }
          }

          if (['added', 'changed', 'removed'].includes(msgType)) {
            const collection = data.collection;
            const docId = data.id;
            const fields = data.fields || {};

            if (!this.collections[collection]) {
              this.collections[collection] = {};
            }

            if (msgType === 'added') {
              this.collections[collection][docId] = fields;
            } else if (msgType === 'changed') {
              this.collections[collection][docId] = {
                ...(this.collections[collection][docId] || {}),
                ...fields,
              };
            } else if (msgType === 'removed') {
              delete this.collections[collection][docId];
            }

            this.emit('data_changed', msgType, collection, docId, fields);
          }
        };

        this.ws.onclose = () => {
          this.emit('disconnected');
          if (!this.isExplicitClose) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (err) => {
          this.emit('error', err);
          reject(err);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 2000);
  }

  public async call(method: string, ...params: any[]): Promise<any> {
    if (!this.isConnected()) {
      await this.connect();
    }

    const callId = `call_${this.nextId++}`;
    const payload = {
      msg: 'method',
      method,
      params,
      id: callId,
    };

    return new Promise((resolve, reject) => {
      this.pendingCalls.set(callId, { resolve, reject });
      this.ws?.send(JSON.stringify(payload));
    });
  }

  public subscribe(name: string, params: any[] = []): string {
    const subId = generateSubscriptionId(name, params);
    this.subscriptions.set(subId, { name, params });

    if (this.isConnected()) {
      this.ws?.send(JSON.stringify({
        msg: 'sub',
        name,
        params,
        id: subId,
      }));
    }
    return subId;
  }

  private resumeSubscriptions(): void {
    for (const [subId, sub] of this.subscriptions.entries()) {
      this.ws?.send(JSON.stringify({
        msg: 'sub',
        name: sub.name,
        params: sub.params,
        id: subId,
      }));
    }
  }

  public close(): void {
    this.isExplicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}