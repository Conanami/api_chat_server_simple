// require express
const express = require("express");
// create express server
const app = express();
//express-ws for web socket
var expressWs = require("express-ws");
expressWs(app);

const Cache = require("cache");
const cache = new Cache(7200 * 1000);

const { randomUUID } = require("crypto");

// Notice: Middleware need configuration before route
// use the middleware express.json(),to parse Json form data
app.use(express.json());
// use middleware express.urlencoded(), to parse url-encoded form data
app.use(express.urlencoded({ extended: false }));

app.get("/user", (req, res) => {
  res.send({ a: "hello" });
});

//map to a single file
app.use("/d", express.static("data.json"));

// create Chatroom
async function createRoom(msgObj) {
  let id = randomUUID().replace(new RegExp("-", "g"), "");
  //  new chatroom expired in 1 hour
  if (msgObj.body == undefined) {
    msgObj.body = { name: id.substring(0, 3), size: 2 };
  }
  if (parseInt(msgObj.body.size) == 2) {
    id = "2s" + id;
  } else {
    id = "0s" + id;
  }

  let key = "chat_room:" + id;
  let obj = {
    id: id,
    users: [],
    pubs: {},
    nicknames: {},
    name: msgObj.body.name,
    size: msgObj.body.size,
  };
  // console.log('obj.size', obj.size, msgObj.body)
  if (parseInt(obj.size) == 0) {
    //if it's an unlimit chatroom , return allmember key.
    obj.passwd = randomUUID().replace(new RegExp("-", "g"), "").substring(0, 8);
  }
  cache.put(key, JSON.stringify(obj), 1800 * 1000);
  return obj;
}

// join room
async function joinRoom(msgObj) {
  let roomid = msgObj.body.roomid;
  let userid = msgObj.body.userid;
  let nickname = msgObj.body.nickname;
  let pub = msgObj.body.pub; //public key
  let key = "chat_room:" + roomid;
  if (cache.get(key) == null) {
    throw new Error(key + " Chatroom do not exist!");
  }

  let obj = JSON.parse(cache.get(key));
  //nickname updated
  if (nickname != undefined && nickname.length > 0) {
    obj.nicknames[userid] = nickname;
    cache.put(key, JSON.stringify(obj), 7200 * 1000);
  }

  if (obj.users.indexOf(userid) == -1) {
    if (parseInt(obj.size) == 2 && obj.users.length >= 2) {
      throw new Error(key + " no more space");
    }
    obj.users.push(userid);
    obj.pubs[userid] = pub;

    cache.put(key, JSON.stringify(obj), 7200 * 1000);
  }

  //total users, online users
  obj.total = obj.users.length;
  obj.online = obj.users.filter((x) => {
    return pool[x];
  }).length;

  // send message to all
  for (var i = 0; i < obj.users.length; i++) {
    let key = obj.users[i];
    send({ type: msgObj.type, from: "server", to: key, body: obj });
  }
}

// send message
async function sendRoomMsg(msgObj) {
  let from = msgObj.from; // from
  let to = msgObj.to; // to is chatroom id
  let key = "chat_room:" + to;
  if (cache.get(key) == null) {
    throw new Error(key + " chatroom do not exist!");
  }
  let room = JSON.parse(cache.get(key));

  //send message to all expect sender
  for (var i = 0; i < room.users.length; i++) {
    let key = room.users[i];
    if (key != from) {
      send({ type: 300, from: from, to: key, body: msgObj.body });
    }
  }
  //  reply 140 to sender.
  send({
    type: 140,
    from: from,
    to: from,
    body: { message: "successfully send" },
  });
}

// message handle
function handle(ws, msgObj) {
  let type = parseInt(msgObj.type);
  switch (type) {
    case 100:
      // heartbeat
      send({ type: msgObj.type, to: msgObj.from, body: msgObj.body });
      break;
    case 120:
      // create chatroom
      createRoom(msgObj).then((obj) => {
        send({ type: msgObj.type, from: "server", to: msgObj.from, body: obj });
      });
      break;
    case 130:
      // join chatroom
      joinRoom(msgObj).catch((error) => {
        // console.log('error:', error)
        send({
          type: msgObj.type,
          from: "server",
          to: msgObj.from,
          body: { error: error.message },
        });
      });
      break;
    case 140:
      // send message
      sendRoomMsg(msgObj).catch((error) => {
        console.log("error:", error);
        send({
          type: msgObj.type,
          from: "server",
          to: msgObj.from,
          body: { error: error.message },
        });
      });
      break;
    case 200:
      //update personal info , saved in cache
      updatePersonalInfo(msgObj);
      break;
    case 210:
      //return all users
      findFriends(msgObj.from);
      break;
    case 220: //apply to add contact
    case 230: //friend accept or reject
    case 240: //exchange public key
    case 250: //exchange personal info
    case 300: //chatinfo
    case 310: //received
    case 320: //read
    default:
      // send to destination return a successfully send
      send({
        type: msgObj.type,
        from: "server",
        to: msgObj.from,
        body: { msg: "successfully send" },
      });
      send({
        type: msgObj.type,
        from: msgObj.from,
        to: msgObj.to,
        body: msgObj.body,
      });
      break;
  }
}

var pool = {};

//update personal info type==200
function updatePersonalInfo(msgObj) {
  // redis.hset('chat_server::userlist', msgObj.from, JSON.stringify(msgObj.body)).then(()=>{
  //   send({'type':200, 'from':'server', 'to': msgObj.from, 'body': msgObj.body});
  // });
}

// find friend
function findFriends(from) {
  // redis.hgetall('chat_server::userlist').then((data)=>{
  //   let arrs = Object.values(data)
  //   let arrs2 = []
  //   arrs.forEach((item, index)=>{
  //     arrs2.push(JSON.parse(item))
  //   });
  //   send({'type':210, 'from':'server', 'to':from, 'body': arrs2});
  // })
}

// store message in  redis
async function saveMsgToCache(msgObj) {
  console.log("save msg", JSON.stringify(msgObj));
  let key = "chat_cache_msg:" + msgObj.to;
  if (cache.get(key) == null) {
    cache.put(key, "[]");
  }
  let arrs = JSON.parse(cache.get(key));
  arrs.push(msgObj);
  cache.put(key, JSON.stringify(arrs), 24 * 3600 * 1000);
}

//send message
async function send(msgObj) {
  msgObj.time = new Date().getTime();
  if (pool[msgObj.to] == undefined) {
    //not online
    console.log(msgObj.to, "not online");
    let type = parseInt(msgObj.type);
    if (type == 300) {
      // store in cache
      await saveMsgToCache(msgObj);
    }
  } else {
    let msg = JSON.stringify(msgObj);
    console.log("response " + msgObj.to, msg);
    pool[msgObj.to].send(msg);
  }
}

// resend
async function reSendCacheMsg(to) {
  let key = "chat_cache_msg:" + to;
  if (cache.get(key) == null) {
    cache.put(key, "[]");
  }
  let arrs = JSON.parse(cache.get(key));
  if (arrs) {
    for (let index = 0; index < arrs.length; index++) {
      const element = arrs[index];
      pool[to].send(JSON.stringify(element));
    }
  }
  //release cache
  cache.del(key);
}

app.ws("/ws/:id", (ws, req) => {
  //user online
  let fromId = req.params.id;
  // store user for 30 min, if active, extend
  // redis.set('user:'+fromId, JSON.stringify({time: new Date()}), {EX: 1800, NX: true})
  cache.put(
    "user:" + fromId,
    JSON.stringify({ time: new Date() }),
    1800 * 1000
  );

  console.log(fromId, "go online");

  // store in cache
  pool[fromId] = ws;

  // send welcome
  send({
    type: 110,
    to: fromId,
    from: "server",
    body: { text: "Connected,Welcome" },
  });

  // get message from Redis
  reSendCacheMsg(fromId);

  // listen to message , get websocket data from client
  ws.on("message", (msg) => {
    try {
      console.log(fromId, " receive:", msg);
      let obj = JSON.parse(msg);
      obj.from = fromId;
      // handle
      handle(ws, obj);
    } catch (error) {
      console.error(error);
      ws.send(
        JSON.stringify({
          type: 400,
          to: fromId,
          from: "server",
          body: { text: "Error:" + error },
        })
      );
    }
  });

  ws.on("close", async (e) => {
    delete pool[fromId];
    cache.del("user:" + fromId);
    // await redis.del('user:'+fromId);
    console.log("close, ", fromId, " up line", e);
  });
});

let port = process.env.PORT;
if (port == null || port == "") {
  port = 8000; //default port
}

//  app.listen , port start web server
app.listen(port, function () {
  // redis.connect();
  // tt();
  console.log("Express server running at http://127.0.0.1");
});
