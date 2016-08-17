import * as proto from "./protocol";
import { nop, pathcat, wrapPromise } from "./utils";
import { JSONWebSocket } from "./jsonws";
import { RTCConnection } from "./rtc";
import { createCall, Call } from "./call";
import { createRoom, DirectRoom, Room } from "./room";

class ArtichokeREST {
    constructor(config) {
        this.log = config.log;
        this.apiKey = config.apiKey;
        this.url = "//" + pathcat(config.url, "api");

        this.callPath = "calls";
        this.chatPath = "chat";
        this.roomPath = "rooms";
    }

    // Call API:
    createCall(user) {
        return this._post(pathcat(this.url, this.callPath), proto.CallCreate(user));
    }

    getCall(callId) {
        return this._get(pathcat(this.url, this.callPath, callId));
    }

    getCalls() {
        return this._get(pathcat(this.url, this.callPath));
    }

    // Chat API:
    getChatHistory(roomId) {
        return this._get(pathcat(this.url, this.chatPath, roomId));
    }

    // Chat room API:
    createRoom(name) {
        return this._post(pathcat(this.url, this.roomPath), proto.RoomCreate(name));
    }

    createDirectRoom(sessionId) {
        return this._post(pathcat(this.url, this.roomPath), proto.RoomCreateDirect(sessionId));
    }

    getRoom(roomId) {
        return this._get(pathcat(this.url, this.roomPath, roomId));
    }

    getRooms() {
        return this._get(pathcat(this.url, this.roomPath));
    }

    getRoster() {
        return this._get(pathcat(this.url, this.roomPath, "unread"));
    }

    getUsers(roomId) {
        return this._get(pathcat(this.url, this.roomPath, roomId, "users"));
    }

    joinRoom(roomId) {
        return this._post(pathcat(this.url, this.roomPath, roomId, "join"), "");
    }

    leaveRoom(roomId) {
        return this._post(pathcat(this.url, this.roomPath, roomId, "leave"), "");
    }

    inviteToRoom(roomId, sessionId) {
        return this._post(pathcat(this.url, this.roomPath, roomId, "invite", sessionId), "");
    }

    _responseCallback(xhttp, resolve, reject) {
        let _this = this;
        return function() {
            if (xhttp.readyState === 4 && xhttp.status === 200) {
                _this.log("OK response: " + xhttp.responseText);
                resolve(JSON.parse(xhttp.responseText));
            } else if (xhttp.readyState === 4 && xhttp.status === 204) {
                _this.log("NoContent response.");
                resolve(null);
            } else if (xhttp.readyState === 4) {
                _this.log("Error response: " + xhttp.responseText);
                try {
                    reject(JSON.parse(xhttp.responseText));
                } catch (error) {
                    reject(null); // FIXME Make sure that this never happens.
                }
            }
        };
    }

    _get(url) {
        let _this = this;
        return new Promise(function(resolve, reject) {
            let xhttp = new XMLHttpRequest();
            xhttp.onreadystatechange = _this._responseCallback(xhttp, resolve, reject);
            _this.log("GET " + url);
            xhttp.open("GET", url, true);
            xhttp.setRequestHeader("X-Api-Key", _this.apiKey);
            xhttp.send();
        });
    }

    _post(url, obj) {
        let _this = this;
        return new Promise(function(resolve, reject) {
            let json = JSON.stringify(obj);
            let xhttp = new XMLHttpRequest();
            xhttp.onreadystatechange = _this._responseCallback(xhttp, resolve, reject);
            _this.log("POST " + url + " " + json);
            xhttp.open("POST", url, true);
            xhttp.setRequestHeader("Content-Type", "application/json");
            xhttp.setRequestHeader("X-Api-Key", _this.apiKey);
            xhttp.send(json);
        });
    }
}

class ArtichokeWS extends JSONWebSocket {
    constructor(config) {
        super("wss://" + pathcat(config.url, "ws", config.apiKey), config);
        this.promises = {};
    }

    // Call API:
    sendOffer(callId, sdp) {
        this.send(proto.CallOffer(callId, sdp));
    }

    answerCall(callId, sdp) {
        this.send(proto.CallAnswer(callId, sdp));
    }

    hangupCall(callId, reason) {
        this.send(proto.CallHangup(callId, reason));
    }

    sendCandidate(callId, candidate) {
        this.send(proto.CallCandidate(callId, candidate));
    }

    // Chat API:
    setDelivered(messageId, timestamp) {
        this.send(proto.ChatDelivered(messageId, timestamp));
    }

    // Room API:
    sendMessage(roomId, body) {
        let _this = this;
        return new Promise(function(resolve, reject) {
            let ref = "ref" + Date.now(); // FIXME Use UUID instead.
            _this.promises[ref] = {
                resolve,
                reject
            };
            _this.send(proto.ChatRequest(roomId, body, ref));
        });
    }

    sendTyping(roomId) {
        this.send(proto.Typing(roomId));
    }

    onMessage(callback) {
        let _this = this;
        super.onMessage(function(msg) {
            if (msg.type === "error" && msg.ref) {
                _this._reject(msg.ref, msg);
            } else if (msg.ref) {
                _this._resolve(msg.ref, msg);
            }
            callback(msg);
        });
    }

    _resolve(ref, value) {
        if (ref in this.promises) {
            this.promises[ref].resolve(value);
            delete this.promises[ref];
        }
    }

    _reject(ref, error) {
        if (ref in this.promises) {
            this.promises[ref].reject(error);
            delete this.promises[ref];
        }
    }

    setMark(roomId, timestamp) {
        this.send(proto.Mark(roomId, timestamp));
    }
}

export class Artichoke {
    constructor(config) {
        this.config = config;
        this.log = config.log;

        this.log("this.config: " + JSON.stringify(this.config));

        this.rest = new ArtichokeREST(config);

        // User config:
        this.sessionId = config.sessionId;
        this.apiKey = config.apiKey;

        // Connection state:
        this.rtc = undefined;
        this.socket = undefined;

        this.callbacks = {};

        // NOTE By default do nothing.
        this.onErrorCallback = nop;
        this.onEvent("msg_received", nop);
        this.onEvent("msg_delivered", nop);
        this.onEvent("call_candidate", nop);
    }

    // Callbacks:
    onConnect(callback) {
        this.onEvent("hello", callback);
    }

    onEvent(type, callback) {
        this.log("Registered callback for message type: " + type);
        if (!(type in this.callbacks)) {
            this.callbacks[type] = [];
        }
        this.callbacks[type].push(callback);
    }

    onError(callback) {
        this.onErrorCallback = callback;
    }

    // API:
    connect() {
        this.rtc = new RTCConnection(this.config);
        this.socket = new ArtichokeWS(this.config);

        let _this = this;
        this.socket.onMessage(function(m) {
            switch (m.type) {
            case "call_answer":
                _this.rtc.setRemoteDescription("answer", m.sdp, function(candidate) {
                    _this.socket.sendCandidate(m.id, candidate);
                });
                break;

            case "call_hangup":
                _this.rtc.reconnect();
                break;

            case "call_candidate":
                _this.rtc.addICECandidate(m.candidate);
                break;

            case "call_created":
                // FIXME Adjust message format in the backend.
                _this._runCallbacks({
                    type: "call_created",
                    creator: m.creator,
                    call: createCall(m, _this)
                });
                return;

            case "room_created":
                m.room = createRoom(m.room, _this);
                break;

            case "error":
                _this.onErrorCallback(m);
                return;

            case "message":
                if (!m.delivered) {
                    _this.socket.setDelivered(m.id, Date.now());
                }
                break;

            default: break;
            }
            _this._runCallbacks(m);
        });
    }

    // Call API:
    onCall(callback) {
        this.onEvent("call_created", callback);
    }

    createCall(user) {
        return this._wrapCall(this.rest.createCall(user));
    }

    getCall(call) {
        return this._wrapCall(this.rest.getCall(call));
    }

    getCalls(call) {
        return this._wrapCall(this.rest.getCalls(call));
    }

    // Chat room API:
    onRoom(callback) {
        this.onEvent("room_created", callback);
    }

    createRoom(name) {
        return this._wrapRoom(this.rest.createRoom(name));
    }

    createDirectRoom(peer) {
        return this._wrapRoom(this.rest.createDirectRoom(peer));
    }

    getRoom(room) {
        return this._wrapRoom(this.rest.getRoom(room));
    }

    getRooms() {
        return this._wrapRoom(this.rest.getRooms());
    }

    getRoster() {
        return this._wrapRoom(this.rest.getRoster());
    }

    // Utils:
    _wrapCall(promise) {
        return wrapPromise(promise, createCall, [this]);
    }

    _wrapRoom(promise) {
        return wrapPromise(promise, createRoom, [this]);
    }

    _runCallbacks(m) {
        if (m.type in this.callbacks) {
            this.log("Running callbacks for message type: " + m.type);
            return this.callbacks[m.type].forEach((cb) => cb(m));
        } else {
            this.log("Unhandled message: " + JSON.stringify(m));
            this.onErrorCallback({"reason": "Unhandled message.", "message": m});
        }
    }
}
