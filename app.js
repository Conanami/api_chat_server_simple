// 导入 express 模块
const express = require('express')
// 创建 express 的服务器实例
const app = express()

var expressWs = require('express-ws');
expressWs(app);

const Cache = require( "cache" );
const cache = new Cache( 7200*1000 );

const { randomUUID } = require('crypto');

// 注意：除了错误级别的中间件，其他的中间件，必须在路由之前进行配置
// 通过 express.json() 这个中间件，解析表单中的 JSON 格式的数据
app.use(express.json())
// 通过 express.urlencoded() 这个中间件，来解析 表单中的 url-encoded 格式的数据
app.use(express.urlencoded({ extended: false }))

app.get('/user', (req, res) => {
  res.send({a:'hello'})
})

//可以直接影射单个文件
app.use('/d', express.static('data.json'))

// 创建聊天室
async function createRoom(msgObj){
  let id = randomUUID().replace(new RegExp("-",'g'), '')
  //  默认新聊天室 一个小时过期
  if(msgObj.body==undefined){
    msgObj.body = {name:id.substring(0, 3), size: 2}
  }
  if (parseInt(msgObj.body.size)==2){
    id = '2s' + id
  }else{
    id = '0s' + id
  }

  let key = 'chat_room:'+id;
  let obj = {id:id, users:[], pubs:{}, nicknames:{}, name: msgObj.body.name, size: msgObj.body.size}
  // console.log('obj.size', obj.size, msgObj.body)
  if (parseInt(obj.size)==0){
    //如果聊天室人员超过2人，返回全局密钥
    obj.passwd = randomUUID().replace(new RegExp("-",'g'), '').substring(0,8)
  }
  cache.put(key, JSON.stringify(obj), 1800*1000)
  return obj
}

// 加入聊天室
async function joinRoom(msgObj){
  let roomid = msgObj.body.roomid
  let userid = msgObj.body.userid
  let nickname = msgObj.body.nickname 
  let pub = msgObj.body.pub   //聊天公钥
  let key = 'chat_room:'+roomid;
  if(cache.get(key)==null){
    throw new Error( key+ ' 聊天室不存在')
  }

  let obj = JSON.parse(cache.get(key))
  //nickname 每次都更新
  if(nickname!=undefined && nickname.length>0){
    obj.nicknames[userid] = nickname
    cache.put(key, JSON.stringify(obj), 7200*1000)
  }

  if (obj.users.indexOf(userid)==-1){
    if(parseInt(obj.size)==2 && obj.users.length>=2){
      throw new Error(key+ ' 聊天室人数已满')
    }
    obj.users.push(userid)
    obj.pubs[userid] = pub

    cache.put(key, JSON.stringify(obj), 7200*1000)
  }
  
  //新增总人数，在线人数
  obj.total = obj.users.length
  obj.online = obj.users.filter((x)=>{
    return pool[x]
  }).length

  // 给聊天室的所有人发送信息
  for(var i=0; i<obj.users.length; i++){
    let key = obj.users[i]
    send({'type':msgObj.type, from: 'server', to: key, body: obj})
  }
}

// 发送聊天室消息
async function sendRoomMsg(msgObj){
  let from  = msgObj.from // from 是发送者
  let to = msgObj.to // 这个时候 to 是 聊天室的id
  let key = 'chat_room:'+to;
  if(cache.get(key)==null){
    throw new Error( key+ ' 聊天室不存在')
  }
  let room = JSON.parse(cache.get(key))

  //消息发给 非发送者的所有人
  for(var i=0; i<room.users.length; i++){
    let key = room.users[i]
    if (key!=from){
      send({type:300, from: from, to: key, body: msgObj.body})
    }
  }
  //  给发送者回复140，告知发送成功
  send({type:140, from: from, to: from, body: {message:'发送成功'}})
}

// 消息处理函数
function handle(ws, msgObj){
  let type = parseInt(msgObj.type)
  switch (type) {
    case 100:
      // 心跳返回
      send({'type':msgObj.type, to: msgObj.from, body: msgObj.body});
      break;
    case 120:
      // 创建聊天室
      createRoom(msgObj).then((obj)=>{
        send({'type':msgObj.type, from: 'server', to: msgObj.from, body: obj})
      })
      break;
    case 130:
      // 加入聊天室
      joinRoom(msgObj).catch((error)=>{
        // console.log('error:', error)
        send({'type':msgObj.type, from: 'server', to: msgObj.from, body: {error: error.message}})
      })
      break;
    case 140:
      // 发送聊天室消息
      sendRoomMsg(msgObj).catch((error)=>{
        console.log('error:', error)
        send({'type':msgObj.type, from: 'server', to: msgObj.from, body: {error: error.message}})
      })
      break
    case 200:
      //个人信息修改指令， 存入 cache
      updatePersonalInfo(msgObj);
      break;
    case 210:
      //好友搜索指令, 暂时返回全部用户
      findFriends(msgObj.from);
      break;
    case 220:   //申请加好友
    case 230:   //好友申请通过或者拒绝
    case 240:   //交换公钥
    case 250:   // 交换基本资料信息
    case 300:   //聊天信息
    case 310:   //聊天确认收到信息
    case 320:   //聊天确认已读
    default:
      // 默认，消息发给目的地，并给自己回复一个成功
      send({'type':msgObj.type, from: 'server', to: msgObj.from, body: {msg:'发送成功'}});
      send({'type':msgObj.type, from: msgObj.from, to: msgObj.to, body: msgObj.body});
      break;
  }
}

var pool = {};


//更新个人资料 type==200
function updatePersonalInfo(msgObj){
  //个人信息修改指令， 存入 cache
  // redis.hset('chat_server::userlist', msgObj.from, JSON.stringify(msgObj.body)).then(()=>{
  //   send({'type':200, 'from':'server', 'to': msgObj.from, 'body': msgObj.body});
  // });
}

// 搜索好友
function findFriends(from){
  // redis.hgetall('chat_server::userlist').then((data)=>{
  //   let arrs = Object.values(data)
  //   let arrs2 = []
  //   arrs.forEach((item, index)=>{
  //     arrs2.push(JSON.parse(item))
  //   });
  //   send({'type':210, 'from':'server', 'to':from, 'body': arrs2});
  // })
}

// 消息缓存到 redis
async function saveMsgToCache(msgObj){
  console.log('save msg', JSON.stringify(msgObj));
  let key = 'chat_cache_msg:'+msgObj.to;
  if(cache.get(key)==null){
    cache.put(key, '[]')
  }
  let arrs = JSON.parse(cache.get(key))
  arrs.push(msgObj);
  cache.put(key, JSON.stringify(arrs), 24*3600*1000)
}

//发送消息
async function send(msgObj){
  msgObj.time = new Date().getTime();
  if(pool[msgObj.to]==undefined){
    //对方不在线
    console.log(msgObj.to,  'not online');
    let type = parseInt(msgObj.type)
    if(type==300){
      // 暂时只有聊天正文消息 需要缓存，其他忽略
      await saveMsgToCache(msgObj);
    }
  }else{
    let msg = JSON.stringify(msgObj)
    console.log('response '+msgObj.to, msg)
    pool[msgObj.to].send(msg);
  }
}

// 重发缓存的消息
async function reSendCacheMsg(to){
  
    let key = 'chat_cache_msg:'+to;
    if(cache.get(key)==null){
      cache.put(key, '[]')
    }
    let arrs = JSON.parse(cache.get(key));
    if(arrs){
      for (let index = 0; index < arrs.length; index++) {
        const element = arrs[index];
        pool[to].send(JSON.stringify(element));
      }
    }
    //清空缓存
    cache.del(key)
}

app.ws('/ws/:id', (ws, req)=>{
    //用户上线
    let fromId = req.params.id;
    // 存储用户 默认半个小时，有活动再续
    // redis.set('user:'+fromId, JSON.stringify({time: new Date()}), {EX: 1800, NX: true})
    cache.put('user:'+fromId, JSON.stringify({time: new Date()}), 1800 * 1000)
    
    console.log(fromId, 'go online')
    
    // 存储到缓存中
    pool[fromId] = ws;

    // 发送欢迎消息
    send({'type':110,'to':fromId, 'from':'server', 'body':{'text':'连接成功,欢迎欢迎'}})
    
    // 缓存的消息从redis取出发出来
    reSendCacheMsg(fromId);

    // 监听 message 事件，拿到客户端通过 websocket 发送过来的数据
    ws.on('message', (msg)=> {
      try {
        console.log(fromId, ' receive:', msg);
        let obj = JSON.parse(msg)
        obj.from = fromId;
        //正常消息处理
        handle(ws, obj); 
      } catch (error) {
        console.error(error);
        ws.send(JSON.stringify({'type':400,'to':fromId, 'from':'server', 'body':{'text':'异常:'+error}}))
      }
    })

    ws.on('close', async (e)=>{
      delete pool[fromId]
      cache.del('user:'+fromId)
      // await redis.del('user:'+fromId);
      console.log('close, ', fromId, ' up line', e)
    })
})


let port = process.env.PORT;
if (port == null || port == "") {
  port = 8000;
}

// 调用 app.listen 方法，指定端口号并启动web服务器
app.listen(port, function () {
  // redis.connect();
  // tt();
  console.log('Express server running at http://127.0.0.1')
})

