import { Codec, EventEntity } from "./codec";
import { Callback } from "./events";
import { Logger } from "./logger";

export class JSONWebSocket<T extends EventEntity> {
  private log: Logger;
  private socket: WebSocket;
  private codec: Codec<T>;

  private onCloseCallback: Callback<CloseEvent>;
  private onErrorCallback: Callback<Event>;
  private onMessageCallback: Callback<MessageEvent>;

  constructor(log: Logger, codec: Codec<T>) {
    this.log = log;
    this.codec = codec;
  }

  connect(url: string) {
    this.log("WS connecting to: " + url);

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.log("WS connected to: " + url);
    };

    this.setupOnClose(this.onCloseCallback);
    this.socket.onerror = this.onErrorCallback;
    this.socket.onmessage = this.onMessageCallback;
  }

  disconnect() {
    this.socket.close();
  }

  onDisconnect(callback: Callback<CloseEvent>) {
    this.onCloseCallback = (close) => {
      this.socket = undefined;
      this.log("WS disconnected: " + close.reason);
      callback(close);
    };

    if (this.socket) {
      this.setupOnClose(this.onCloseCallback);
    }
  }

  onError(callback: Callback<Event>) {
    this.onErrorCallback = (err) => {
      this.log("WS error: " + err);
      callback(err);
    };

    if (this.socket) {
      this.socket.onerror = this.onErrorCallback;
    }
  }

  onEvent(callback: Callback<T>) {
    this.onMessageCallback = (event) => {
      this.log("WS received: " + event.data);
      callback(this.codec.decode(event.data));
    };

    if (this.socket) {
      this.socket.onmessage = this.onMessageCallback;
    }
  }

  send(event: T): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const json = this.codec.encode(event);
      this.log("WS sent: " + json);
      this.socket.send(json);
      return Promise.resolve();
    } else {
      return Promise.reject<void>(new Error("Websocket is not connected!"));
    }
  }

  private setupOnClose(callback) {
    this.socket.onclose = callback;
    const wrappedCallback = (close) => {
      close.reason = "Browser offline.";
      close.code = 1006; // NOTE WebSocket.CLOSE_ABNORMAL
      callback(close);
    };
    if (typeof window.addEventListener !== "undefined") {
      window.addEventListener("offline", wrappedCallback);
    } else if (window.document && window.document.body) {
      (window.document.body as any).onoffline = wrappedCallback;
    }
    // TODO Check heartbeats.
  }
}
