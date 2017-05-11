$(document).ready(function() {
    displayVersion();

    if(!RatelSDK.isBrowserSupported()) {
        alert("This browser is not supported :(");
        throw new Error("Unsupported browser.");
    }

    var sessionId = undefined;
    var loginBox = makeLoginBox();
    var chat = makeChat();
    var userPhone = undefined;

    var chatboxes = {};
    var callIndex = 1;

    var users = {};
    var getSessionId = function() {};
    var getUserNickname = function() {};
    var newRoom = function() {};

    var status = "available";
    var statusSwitch = $("#status-switch").click(function() { return false; }).html("Status: " + status).hide();

    var stealSwitch = $("#steal-switch").click(function() { return false; }).hide();

    var killSwitch = $("#kill-switch").click(function() { return false; }).hide();
    $('#demo-name').click(function() {
        killSwitch.show();
    });

    $('#page-contents')
        .append(loginBox.element)
        .append(chat.element);

    loginBox.element.show();

    function makeLoginBox() {
        console.log("Building the login box!");
        var form = makeLoginForm("login-box", function (event) {
            event.preventDefault();
            userPhone = $('#user-phone').val();
            var password = $('#user-password').val();
            run($('#server').val(), $('#ratel-server').val(), userPhone, password).then(
                function () {
                    loginBox.element.hide();
                    chat.element.show();
                }, function (e) {
                    console.error("Authorization failed (" + e + ")");
                    alert("Authorization failed");
                });
        });

        return {
            element: form
        };
    }

    function makeChat() {
        console.log("Building the chat!");
        var chat = makeChatContainer("chat", "room-list", "chatbox-container", "controls-container", function(name) {
            newRoom(name);
        }).hide();
        return {
            element: chat,
            add: function(id, chatbox) {
                chatboxes[id] = chatbox;
                $("#room-list").append(chatbox.switcher.element);
                $("#controls-container").append(chatbox.controls);
                $("#chatbox-container").append(chatbox.element);
            },
            remove: function(id) {
                chatboxes[id].remove();
                delete chatboxes[id];
            }
        };
    }

    function switchTo(id) {
        return function() {
            console.log("Switching to: " + id);

            Object.keys(chatboxes).forEach(function(id) {
                chatboxes[id].deactivate();
            });

            chatboxes[id].activate();
        };
    }

    function makeBoxSwitcher(id, name, onClose) {
        console.log("Building a switcher for: ", name);

        var unread = makeBadge();
        var switcher = makeSwitcher(id, [name, " ", unread], switchTo(id), onClose);

        return {
            element: switcher,
            isActive: function() {
                return switcher.hasClass("active");
            },
            activate: function() {
                switcher.addClass("active");
            },
            deactivate: function() {
                switcher.removeClass("active");
            },
            resetUnread: function() {
                unread.html("");
            },
            bumpUnread: function() {
                unread.html(1 + (parseInt(unread.html() || "0")));
            },
            remove: function() {
                switcher.remove();
            }
        };
    }

    function makeReceiver(room, text) {
        function receive(msg, className, sender, body) {
            room.getMark().then(function(mark) {
                if(msg.timestamp > mark) {
                    if(!chatboxes[room.id].isActive()) {
                        chatboxes[room.id].bumpUnread();
                    } else {
                        room.setMark(msg.timestamp);
                    }
                }
            }).catch(function(error) {
                console.log("Could not retrieve the mark: ", error);
            });
            var line = makeTextLine(msg.id, className, msg.timestamp, sender, body);
            text.append(line);
            text.trigger('scroll-to-bottom');
            return line;
        }

        return {
            media: function(media) {
                var e = media.edited ? " edited" : "";
                return receive(media, "media" + e, getUserNickname(media.user), makeEmbed({
                    type: "media",
                    media: media
                }));
            },
            message: function(msg) {
                var d = !!msg.delivered ? " delivered" : "";
                var e = !!msg.edited ? " edited" : "";
                return receive(msg, "message" + d + e, getUserNickname(msg.user), msg.body);
            },
            metadata: function(meta) {
                return receive(meta, "metadata", getUserNickname(meta.user), makeEmbed(meta.payload));
            },
            action: function(action) {
                var target = (action.action === "invited" ? getUserNickname(action.invitee) : "the room");
                return receive(action, "info", "", "User " + getUserNickname(action.user) + " " + action.action + " " + target + ".");
            }
        };
    }

    function editLine(m) {
        $('#'+ m.id).addClass('edited');
        switch(m.type) {
        case "message":
            $('#'+ m.id + ' > .contents').text(m.body);
            break;

        case "media":
            $('#'+ m.id + ' > .contents').replaceWith(makeEmbed({
                type: "media",
                media: m
            }));
        }
    }

    function deliverLine(m) {
        $('#' + m.id).addClass("delivered");
    }

    function clickEditor(m) {
        return function () {
            console.log("Editing the message!");
            m.edit("I did not mean to post this...");
            editLine(m);
        }
    }

    function makeDirectChatbox(room, directCallBuilder) {
        console.log("Building direct chatbox: ", room);

        // FIXME 2hacky4me
        var peer = room.users.filter(function(u) {
            return u !== sessionId;
        })[0];

        var text = makeTextArea("chatbox-textarea");
        var receive = makeReceiver(room, text);

        room.onMessage(function(msg) {
            msg.markDelivered();
            msg.onEdit(editLine);
            receive.message(msg);
        });

        room.onMetadata(receive.metadata);

        room.onMedia(function(media) {
            media.onEdit(editLine);
            receive.media(media);
        });

        var input = makeInputField("Send!", function(input) {
            room.send(input).then(function (msg) {
                msg.onDelivery(deliverLine);
                msg.onEdit(editLine);
                console.log("Received ack for message: ", msg);
                receive.message(msg).click(clickEditor(msg));
            }).catch(function(error) {
                console.log("Sending message failed: ", error);
            });
        }, function() {});

        var chatbox = makeChatbox(room.id, "chatbox", text, input).hide();
        var switcher = makeBoxSwitcher(room.id, getUserNickname(peer));

        var avatar = makeAvatar('avatar', "http://vignette2.wikia.nocookie.net/creepypasta/images/4/4b/1287666826226.png");
        var label = makeLabel(room.id, "", getUserNickname(peer));

        var call = makeButton("btn-success", "Call!", function() {
            if(!call.hasClass("disabled")) {
                call.addClass("disabled");
                directCallBuilder(room, peer);
            }
        });

        var buttons = makeButtonGroup().append(call);
        var panel = makePanel([avatar, makeLineBreak(), label]).addClass('controls-wrapper');
        var controls = makeControls(room.id, [panel, buttons]).addClass('text-center').hide();

        return {
            element: chatbox,
            switcher: switcher, // FIXME Remove this.
            controls: controls,
            switchTo: switchTo(room.id),
            isActive: function() {
                return switcher.isActive();
            },
            bumpUnread: function() {
                switcher.bumpUnread();
            },
            onStatus: function(user, status) {
                if(user === peer) {
                    switch(status) {
                    case "available":
                        call.removeClass("disabled");
                        break;
                    case "away":
                    case "unavailable":
                        call.addClass("disabled");
                    }
                }
            },
            activate: function() {
                chatbox.show();
                controls.show();
                room.setMark(Date.now());
                switcher.resetUnread();
                switcher.activate();
            },
            deactivate: function() {
                chatbox.hide();
                controls.hide();
                switcher.deactivate();
            },
            receive: receive,
            addCall: function(callbox) {
                call.addClass("disabled");
                callbox.onTeardown(function() {
                    call.removeClass("disabled");
                    switchTo(room.id)();
                });
            },
            remove: function() {
                switcher.remove();
                chatbox.remove();
                controls.remove();
            }
        }
    }

    function makeUserList(onClick) {
        var list = {};
        var users = makePills("nav-stacked user-list");

        function render() {
            users.html("");
            Object.keys(list).forEach(function(user) {
                var colors = {
                    "available": "label label-success",
                    "unavailable": 'label label-default',
                    "away": 'label label-info'
                };
                var pill = makePill(user, makeLabel(user, colors[list[user].status], getUserNickname(user)),
                                    function () {
                                        onClick(user);
                                    });
                if(list[user].isTyping) {
                    pill.addClass("active");
                }
                users.append(pill);
            });
        }

        function deactivate(user) {
            list[user].isTyping = false;
            render();
            if(list[user].timer) {
                window.clearTimeout(list[user].timer);
            }
        }

        return {
            element: users,
            list: function() {
                return Object.keys(list);
            },
            add: function(user) {
                list[user] = {
                    status: "available", // FIXME Actually check this somehow.
                    isTyping: false,
                    timer: null
                };
                render();
            },
            remove: function(user) {
                delete list[user];
                render();
            },
            deactivate: deactivate,
            activate: function(user, time) {
                list[user].isTyping = true;
                render();
                if(list[user].timer) {
                    window.clearTimeout(list[user].timer);
                }
                list[user].timer = window.setTimeout(function() {
                    deactivate(user);
                }, time);
            },
            setStatus: function(user, status) {
                list[user].status = status;
                render();
            }
        }
    }

    function makeGroupChatbox(room, directRoomBuilder, callBuilder, botBuilder) {
        console.log("Building group chatbox for room: ", room);

        var users = makeUserList(function(user) {
            directRoomBuilder(user);
        });

        room.getUsers().then(function(list) {
            list.filter(function(u) {
                return u != getSessionId(userPhone);
            }).forEach(function(u) {
                users.add(u);
            });
        }).catch(function(error) {
            console.log("Fetching user list failed: ", error);
        });

        var text = makeTextArea("chatbox-textarea");
        var receive = makeReceiver(room, text);

        room.onJoined(function(msg) {
            if(msg.user != getSessionId(userPhone)) {
                users.add(msg.user);
            }
            receive.action(msg);
        });

        room.onLeft(function(msg) {
            users.remove(msg.user);
            receive.action(msg);
        });

        room.onInvited(receive.action);

        room.onMessage(function(msg) {
            msg.markDelivered();
            msg.onEdit(editLine);
            receive.message(msg);
            users.deactivate(msg.user);
        });

        room.onMetadata(receive.metadata);

        room.onMedia(function(media) {
            media.onEdit(editLine);
            receive.media(media);
        });

        room.onTyping(function(msg) {
            console.log(msg.user + " is typing!");
            users.activate(msg.user, 5000);
        });

        var input = makeInputField("Send!", function(input) {
            room.send(input).then(function (msg) {
                msg.onDelivery(deliverLine);
                hackersTrap(msg.body);
                console.log("Received ack for message: ", msg);
                receive.message(msg).click(clickEditor(msg));
            }).catch(function(error) {
                console.log("Sending message failed: ", error);
            });
        }, function(input) {
            if([3, 8, 27, 64, 125, 216, 343].includes(input.length)) {
                console.log("Indicating that user is typing.");
                room.indicateTyping();
            }
        });

        var chatbox = makeChatbox(room.id, "chatbox", text, input).hide();
        var switcher = makeBoxSwitcher(room.id, room.name, function() {
            room.leave();
            chat.remove(room.id);
        });

        var invite = makeInputField("Invite!", function(user) {
            room.invite(getSessionId(user).toString());
        }, function() {});

        var createBot = makeNInputField(2, "Bot!", function(args) {
            botBuilder(args[0], args[1], room);
        });

        var call = makeButton("btn-success", "Conference!", function() {
            if(!call.hasClass("disabled")) {
                call.addClass("disabled");
                callBuilder(room, users.list());
            }
        });

        var gif = makeButton("btn-info", "Gif!", function() {
            room.sendMedia({
                mimeType: "image/gif",
                content: randomGif(),
                description: "A random gif image"
            }).then(function(media) {
                receive.media(media).click(clickEditor(media));
            }).catch(function(error) {
                console.log("Could not send gif!: ", error);
            });
        });

        var brag = makeButton("btn-warning", "Brag!", function() {
            room.sendMetadata({
                type: "agent",
                agent: navigator.userAgent
            }).then(receive.metadata).catch(function(error) {
                console.log("Could not send User Agent!: ", error);
            });
        });

        var buttons = makeButtonGroup().append([call, gif, brag]);
        var panel = makePanel(users.element).addClass('controls-wrapper');
        var controls = makeControls(room.id, [panel, invite, createBot, buttons]).addClass('text-center').hide();

        return {
            element: chatbox,
            switcher: switcher, // FIXME Remove this.
            controls: controls,
            switchTo: switchTo(room.id),
            isActive: function() {
                return switcher.isActive();
            },
            onStatus: function(user, status) {
                if(users.list().includes(user)) {
                    users.setStatus(user, status);
                }
            },
            bumpUnread: function() {
                switcher.bumpUnread();
            },
            activate: function() {
                chatbox.show();
                controls.show();
                room.setMark(Date.now());
                switcher.resetUnread();
                switcher.activate();
            },
            deactivate: function() {
                chatbox.hide();
                controls.hide();
                switcher.deactivate();
            },
            addCall: function(callbox) {
                call.addClass("disabled");
                callbox.onTeardown(function() {
                    call.removeClass("disabled");
                    switchTo(room.id)();
                });
            },
            receive: receive,
            remove: function() {
                switcher.remove();
                chatbox.remove();
                controls.remove();
            }
        }
    }

    function addRoom(room, session) {
        if(room.id in chatboxes) {
            return chatboxes[room.id];
        } else {
            console.log("Adding room to the chat: ", room);

            var chatbox = undefined;

            if(room.direct) {
                chatbox = makeDirectChatbox(room, directCallBuilder(session));
            } else {
                chatbox = makeGroupChatbox(room, directRoomBuilder(session), callBuilder(session), botBuilder(session));
            }

            room.getHistory().then(function(msgs) {
                msgs.forEach(function(msg) {
                    switch(msg.type) {
                    case "media":
                        msg.onEdit(editLine);
                        chatbox.receive.media(msg);
                        break;
                    case "message":
                        msg.markDelivered();
                        msg.onEdit(editLine);
                        chatbox.receive.message(msg);
                        break;
                    case "metadata":
                        chatbox.receive.metadata(msg);
                        break;
                    case "action":
                        chatbox.receive.action(msg);
                    }
                });
            }).catch(function(error) {
                console.log("Fetching room history failed: ", error);
            });

            chat.add(room.id, chatbox);
            return chatbox;
        }
    }

    function directRoomBuilder(session) {
        return function(user) {
            session.chat.createDirectRoom(user).then(function(room) {
                addRoom(room, session).switchTo();
            }).catch(function(error) {
                console.log("Creating a direct room failed: ", error);
            });
        }
    }

    function roomBuilder(session) {
        return function(name) {
            session.chat.createRoom("#" + name).then(function(room) {
                room.join();
                addRoom(room, session).switchTo();
            }).catch(function(error) {
                console.log("Creating a room failed: ", error);
            });
        }
    }

    function botBuilder(session) {
        return function(name, callback, room) {
            return session.chat.createBot(name, callback).then(function(bot) {
                internUser(bot);
                room.invite(bot.id);
                alert("Bot credentials: " + bot.id + " " + bot.apiKey);
            }).catch(function(error) {
                console.log("Creating a bot failed: ", error);
            });
        }
    }

    function internUser(user) {
        users[user.id] = user;
    }

    function createStream(callback) {
        navigator.mediaDevices.getUserMedia({
            "video": true,
            "audio": true
        }).then(function(stream) {
            console.log("Local stream started!");
            callback(stream);
        }).catch(function(error) {
            console.log("Could not start stream: ", error);
        });
    }

    function makeCall(call, localStream) {
        console.log("Building a call object for: ", call);

        var users = makeUserList(function() {});
        var streams = {
            "You": {
               "stream": localStream,
               "muted": false,
               "paused": false
            }
        };

        var callbox = makeCallbox(call.id, "callbox");
        var onTeardownCallback = function() {};

        call.onRemoteStream(function(user, stream) {
            console.log("Remote stream for user " + user +  " started!");
            streams[user] = {
                "stream": stream,
                "muted": false,
                "paused": false
            };
            renderStreams();
        });

        call.onStreamMuted(function(m) {
            streams[m.user].muted = true;
            renderStreams();
        });

        call.onStreamUnmuted(function(m) {
            streams[m.user].muted = false;
            renderStreams();
        });

        call.onStreamPaused(function(m) {
            streams[m.user].paused = true;
            renderStreams();
        });

        call.onStreamUnpaused(function(m) {
            streams[m.user].paused = false;
            renderStreams();
        });

        call.onLeft(function(m) {
            console.log("User left the call: ", m);
            delete streams[m.user];
            renderStreams();
            users.remove(m.user);
        });

        call.onJoined(function(m) {
            console.log("User joined the call: ", m);
            users.add(m.user);
        });

        call.onAnswered(function(m) {
            console.log("User answered the call: ", m);
        });

        call.onRejected(function(m) {
            console.log("User rejected the call: ", m);
        });

        call.onEnd(function(e) {
            console.log("Call ended: ", e.reason);
            stealSwitch.hide();
            endCall("ended");
        });

        call.onTransferred(function(e) {
            console.log("Call was transferred to another device: ", e);
        });

        call.onActiveDevice(function(e) {
            console.log("Call is in progress on another device: ", e);
            enableStealSwitch(call);
            callbox.hide();
            stopStream();
            onTeardownCallback();
            chat.remove(call.id);
        });

        function endCall(reason) {
            call.leave(reason);
            callbox.hide();
            stopStream();
            onTeardownCallback();
            chat.remove(call.id);
        }

        function renderStreams() {
            callbox.empty();
            var grid = makeSplitGrid(Object.keys(streams).map(function(user) {
                var isMe = user === "You";
                return makeStreamBox(user, isMe ? "You:" : getUserNickname(user) + ":", streams[user], isMe);
            }));
            callbox.append(grid);
        }

        function stopStream() {
            if(localStream.stop) localStream.stop();
            else localStream.getTracks().map(function(t) { t.stop(); });
        }

        // FIXME Use a proper name instead of call.id
        var name = "Call #" + callIndex;
        callIndex = callIndex + 1;
        var switcher = makeBoxSwitcher(call.id, name, function() {
            endCall("closed");
        });

        var toggle = makeButton('btn-warning', "Toggle stream", function() {
            createImageStream(randomGif(), 10, function(stream) {
                call.addLocalStream(stream);
                streams["You"].stream = stream;
                stopStream();
                localStream = stream;
                renderStreams();
            });
        });

        var mute = makeButton('btn-info', "(Un)mute stream", function() {
            if(streams["You"].muted) {
              call.unmute();
              call.unpause();
            } else {
              call.mute();
              call.pause();
            }
            streams["You"].muted = !streams["You"].muted;
            streams["You"].paused = !streams["You"].paused;
            renderStreams();
        });

        var hangup = makeButton('btn-danger', "Hangup!", function() {
            endCall("hangup");
        });

        var input = undefined;

        if(call.direct) {
            input = makeDiv();
        } else {
            call.onInvited(function(m) {
                console.log(getUserNickname(m.user) + " invited " + m.invitee + " to join the call: ", m);
            });

            input = makeInputField("Invite!", function(userPhone) {
                call.invite(getSessionId(userPhone));
            }, function() {});
        }

        var buttons = makeButtonGroup().append([hangup, mute, toggle]);
        var panel = makePanel(users.element).addClass('controls-wrapper');
        var controls = makeControls(call.id, [panel, input, buttons]).addClass('text-center').hide();
        renderStreams();

        return {
            element: callbox,
            switcher: switcher, // FIXME Remove this.
            controls: controls,
            switchTo: switchTo(call.id),
            isActive: function() {
                return switcher.isActive();
            },
            onStatus: function(user, status) {
                if(users.list().includes(user)) {
                    users.setStatus(user, status);
                }
            },
            activate: function() {
                callbox.show();
                controls.show();
                switcher.activate();
            },
            deactivate: function() {
                callbox.hide();
                controls.hide();
                switcher.deactivate();
            },
            answer: function() {
                call.answer(localStream);
            },
            pull: function() {
                call.pull(localStream);
            },
            onTeardown: function(callback) {
                onTeardownCallback = callback;
            },
            remove: function() {
                callbox.remove();
                controls.remove();
                switcher.remove();
            }
        }
    }

    function addCall(call, stream) {
        var box = makeCall(call, stream);
        call.getHistory(); // NOTE Just for testing purposes.
        chat.add(call.id, box);
        return box;
    }

    function directCallBuilder(session) {
        return function(room, user) {
            createStream(function(stream) {
                session.chat.createDirectCall(stream, user, 10).then(function(call) {
                    var box = addCall(call, stream);
                    chatboxes[room.id].addCall(box);
                    box.switchTo();
                }).catch(function(error) {
                    console.log("Creating a call failed: ", error);
                });
            });
        }
    }

    function callBuilder(session) {
        return function(room, users) {
            createStream(function(stream) {
                session.chat.createCall(stream, users).then(function(call) {
                    var box = addCall(call, stream);
                    chatboxes[room.id].addCall(box);
                    box.switchTo();
                }).catch(function(error) {
                    console.log("Creating a call failed: ", error);
                });
            });
        }
    }

    function enableStealSwitch(call) {
        stealSwitch.click(function() {
            createStream(function(stream) {
                var callbox = addCall(call, stream);
                callbox.pull();
                callbox.switchTo();
            });
            stealSwitch.hide();
        });
        stealSwitch.show();
    }

    function randomGif() {
        var xhttp = new XMLHttpRequest();
        xhttp.open("GET", 'https://api.giphy.com/v1/gifs/random?api_key=dc6zaTOxFJmzC', false);
        xhttp.send();
        return JSON.parse(xhttp.responseText).data.image_original_url.replace(/http:\/\//, 'https://');
    }

    function getURL(server) {
        return new URL((server.startsWith("http") ? "" : window.location.protocol + "//") + server);
    }

    function getUser(url, id, apiKey) {
        var xhttp = new XMLHttpRequest();
        xhttp.open("GET", url + 'api/users/' + id, false);
        xhttp.setRequestHeader('X-Api-Key', apiKey);
        xhttp.send();
        return JSON.parse(xhttp.responseText);
    }

    function logIn(url, phone, password) {
        var xhttp = new XMLHttpRequest();
        xhttp.open("POST", url + 'api/session', false);
        xhttp.setRequestHeader('Content-Type', 'application/json');
        xhttp.send(JSON.stringify({
            "phone": phone,
            "password": password
        }));
        if(xhttp.status !== 200) {
          throw "Invalid credentials.";
        }
        return JSON.parse(xhttp.responseText);
    }

    function run(chatServer, ratelServer, phone, password) {
        var chatUrl = getURL(chatServer);
        var ratelUrl = getURL(ratelServer);

        var user = undefined;
        try {
            user = logIn(ratelUrl, phone, password);
        } catch(e) {
            return Promise.reject(e);
        }

        console.log("Connecting to " + chatUrl + " as: " + JSON.stringify(user));

        getSessionId = function(phone) {
            var sessionId = "nope";
            Object.getOwnPropertyNames(users).forEach(function(id) {
                if(users[id].phone === phone) {
                    sessionId = id;
                }
            });
            return sessionId;
        }

        getUserNickname = function(userId) {
            if(users[userId]) {
                return users[userId].name
            } else {
                var u = getUser(ratelUrl, userId, user.apiKey);
                internUser(u);
                return u.name;
            }
        }

        return RatelSDK.withApiKey(
            user.user.id, // Well fuck.
            user.apiKey,
            {
                "debug": true,
                "ratel": {
                    "protocol": ratelUrl.protocol,
                    "hostname": ratelUrl.hostname,
                    "port": ratelUrl.port,
                },
                "chat": {
                    "protocol": chatUrl.protocol,
                    "hostname": chatUrl.hostname,
                    "port": chatUrl.port,
                    "rtc": {
                        "iceTransportPolicy": "relay",
                        "iceServers": [{
                            "urls": ["stun:turn.ratel.im:5349", "turn:turn.ratel.im:5349"],
                            "username": "test123",
                            "credential": "test456"
                        }]
                    }
                }
            }).then(function (session) {
                sessionId = session.id;
                $('#demo-name').html("Ratel IM - " + user.user.name);
                statusSwitch.show();

                newRoom = roomBuilder(session);

                session.chat.onHeartbeat(function(hb) {
                    console.log("Server time: ", hb.timestamp);
                });

                session.chat.onError(function(error) {
                    console.log("An error has occured: ", error);
                });

                session.chat.onDisconnect(function(close) {
                    console.log("Session disconnected: ", close);
                    alert("Session disconnected: " + close.reason);
                });

                session.chat.onConnect(function(m) {
                    console.log("Connected to Artichoke!");

                    killSwitch.click(function() {
                        // NOTE Kills the client session.
                        session.api.sendCandidate(null, null, null);
                    });

                    statusSwitch.click(function() {
                        statusSwitch.toggleClass(status === "available" ? "btn-success" : "btn-info");
                        status = status === "available" ? "away" : "available";
                        statusSwitch.toggleClass(status === "available" ? "btn-success" : "btn-info");
                        statusSwitch.html("Status: " + status);
                        session.chat.setStatus(status);
                    });

                    session.chat.getBots().then(function(bots) {
                        console.log("Bots: ", bots);
                        bots.forEach(internUser);
                    }).catch(function(error) {
                        console.log("Fetching bots failed: ", error);
                    });

                    session.chat.getRoster().then(function(rooms) {
                        console.log("Roster: ", rooms);

                        var general = undefined;
                        rooms.forEach(function(room) {
                            var r = addRoom(room, session);

                            if(room.name === "#general") {
                                general = r;
                            }
                        });

                        if(general) {
                            general.switchTo();
                        } else {
                            newRoom("general");
                        }
                    }).catch(function(error) {
                        console.log("Fetching roster failed:", error);
                    });

                    session.chat.onBotUpdate(function(m) {
                        console.log("Bot " + m.bot.name + " has been updated: ", m.bot);
                        internUser(m.bot);
                    });

                    session.chat.onStatusUpdate(function(m) {
                        console.log("User " + m.user + " is " + m.status + "!");
                        Object.keys(chatboxes).forEach(function(k) {
                            chatboxes[k].onStatus(m.user, m.status);
                        });
                    });

                    session.chat.onRoom(function (m) {
                        console.log("Received room invitation: ", m);
                        if(!m.room.direct) {
                            var line = getUserNickname(m.inviter) + " invited you to join room " + m.room.name;
                            confirmModal("Room invitation", line, "Join", function() {
                                console.log("Joining room " + m.room.name);
                                m.room.join();
                                addRoom(m.room, session).switchTo();
                            }, "Nope", function() {
                                console.log("Rejecting invitation...");
                            });
                        } else {
                            addRoom(m.room, session);
                        }
                    });

                    session.chat.onCall(function(m) {
                        console.log("Received call offer: ", m);
                        var closeModal = function() {};
                        m.call.onEnd(function(e) {
                            console.log("Call ended: ", e.reason);
                            stealSwitch.hide();
                            closeModal();
                        });
                        m.call.onActiveDevice(function(e) {
                            console.log("Call in progress on another device: ", e);
                            closeModal();
                            enableStealSwitch(m.call);
                        });
                        var line = "";
                        if(m.call.direct) {
                            line = getUserNickname(m.inviter) + " is calling, answer?";
                        } else {
                            line = getUserNickname(m.inviter) + " invites you to join a conference call with " +
                                m.call.users.map(getUserNickname);
                        }
                        closeModal = confirmModal("Call invitation", line, "Answer", function() {
                            createStream(function(stream) {
                                var callbox = addCall(m.call, stream);
                                callbox.answer();
                                callbox.switchTo();
                            });
                        }, "Reject", function () {
                            console.log("Rejecting call...");
                            m.call.reject("rejected");
                        });
                    });
                });

                session.chat.connect();
            });
    }
});

function hackersTrap (word) {
    if (word.indexOf("</script>") !== -1) {
        //destroy this hackier
        $('.body-wrap').css('background-color', 'red');
        setTimeout( function () {
            for(var i = 0 ; i<10000;i++) {
                console.log('HACKER WUWUWUWUWUUWUWUW')
            }
        }, 0);
        setTimeout( function () {
            window.location = "http://www.logout.com";
        });
    }
}
