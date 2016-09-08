import { API } from "../src/api";
import { Artichoke } from "../src/artichoke";
import { Call } from "../src/call";
import { EventHandler } from "../src/events";
import { config, log } from "./fixtures";
import { Event } from "../src/protocol";
import { Room } from "../src/room";

class APIMock extends API {
    cb;

    onEvent(callback) {
        this.cb = callback;
    }

    connect() {
        // Do nothing.
    }
}

describe("Artichoke", () => {
    let events, api, manager;

    beforeEach(() => {
        events = new EventHandler(log);
        api = new APIMock(config, log);
        manager = new Artichoke(config, log, events, api);
    });

    it("should notify on a new event", (done) => {
        events.onEvent("hello", (msg) => done());

        manager.connect();

        api.cb({
            type: "hello"
        } as Event);
    });

    it("should call a callback on server connection", (done) => {
        manager.onConnect((msg) => done());
        manager.connect();

        api.cb({
            type: "hello"
        } as Event);
    });

    it("should call a callback on server error", (done) => {
        manager.onError((error) => done());
        manager.connect();

        api.cb({
            type: "error",
            reason: "why not?"
        } as Event);
    });
});
