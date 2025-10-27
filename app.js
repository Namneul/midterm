const express = require('express');
const app = express();
const path = require('path');
const port = 3000;
const ejsMate = require('ejs-mate');
const maria = require('./models/maria');
const mongoose = require('mongoose');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const AuctionItem = require('./models/AuctionItem')
const { swaggerUi, specs } = require('./swagger');

const http = require('http');
const {Server} = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect('mongodb://localhost:27017/202110935') //
    .then(() => console.log('MongoDB 연결 성공'))
    .catch(err => console.error('MongoDB 연결 실패:', err));

app.engine('ejs', ejsMate);

app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));

const adminRouter = require('./routes/admin');
const mainRouter = require('./routes/index');
const communityRouter = require('./routes/community')
const boardRouter = require('./routes/board');

const sessionMiddleware = session({
    secret: '123123',
    resave: false,
    saveUninitialized: true
});

app.use(sessionMiddleware);
app.use(flash());
app.use((req, res, next) => {req.io = io; next()});
app.use((req, res, next) => {

    res.locals.currentUser = req.session.user;
    res.locals.isAdmin = req.session.user ? (req.session.user.isAdmin === 1 || req.session.user.isAdmin === true) : false;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

const isAdmin = (req, res, next) => {
    if (!res.locals.isAdmin) {
        req.flash('error', '관리자만 접근할 수 있습니다.');
        return res.redirect('/');
    }
    // 관리자 맞으면 통과
    next();
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', mainRouter);
app.use('/community', communityRouter);
app.use('/board', boardRouter);
app.use('/admin', isAdmin, adminRouter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));


io.on('connection', (socket) => {
    console.log(`새로운 유저가 접속했습니다. (ID: ${socket.id})`);

    // 클라이언트가 특정 경매방(room)에 입장
    socket.on('join:room', (roomId) => {
        socket.join(roomId); // auctionId 이름의 방에 조인
        console.log(`유저(ID: ${socket.id})가 ${roomId} 방에 입장했습니다.`);

        // ⭐️ [추가] 방 입장 시, 인원수 갱신 및 브로드캐스트
        updateRoomCount(roomId);

        // ⭐️ [추가] 이 소켓(유저)이 어떤 방에 있는지 기억하기 위함
        socket.currentRoom = roomId;
    });

    socket.on('disconnect', () => {
        console.log(`유저(ID: ${socket.id})가 접속 해제했습니다.`);

        // ⭐️ [추가] 접속 해제 시, 해당 유저가 있던 방의 인원수 갱신
        if (socket.currentRoom) {
            updateRoomCount(socket.currentRoom);
        }
    });
    socket.on('chat:send', (data) => {
        if (socket.currentRoom) {
            // 2. 이 메시지를 보낸 사람을 '제외한' 방 멤버들에게만 전송
            // socket.to(socket.currentRoom).emit('chat:new_message', data);

            // 2. (수정) 이 메시지를 보낸 사람을 '포함한' 방 멤버 모두에게 전송
            io.to(socket.currentRoom).emit('chat:new_message', {
                nickname: data.nickname,
                msg: data.msg
            });
        }
    });
    socket.on('auction:try_end', async (roomId) => {
        console.log(`[경매 종료 시도] ${roomId} 방에서 종료 요청 받음.`);

        try {
            // 2. (중요) 서버에서만 상태를 확인 (경쟁 상태 방지)
            const item = await AuctionItem.findById(roomId);

            // 3. (중요) 'active' 상태일 때만 종료 로직 실행
            if (item && item.status === 'active' && new Date(item.endDate) < new Date()) {

                // 4. 'ended'로 상태 변경 및 저장
                item.status = 'ended';
                await item.save();

                console.log(`[경매 공식 종료] ${roomId}가 'ended'로 변경됨. 결과 방송...`);

                // 5. [핵심] 방 전체에 "경매 종료됨" 이벤트 방송 (낙찰자 정보 포함)
                io.to(roomId).emit('auction:ended', {
                    highestBidderId: item.highestBidderId,
                    highestBidderNickname: item.highestBidderNickname
                });
            } else {
                console.log(`[경매 종료 시도] ${roomId}는 이미 종료되었거나 시간이 남음.`);
            }
        } catch (e) {
            console.error('[auction:try_end] 오류:', e);
        }
    });
});


server.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});

function updateRoomCount(roomId) {
    // 1. 특정 방(roomId)에 접속한 소켓(유저)들의 정보를 가져옵니다.
    const room = io.sockets.adapter.rooms.get(roomId);

    // 2. room이 존재하면 인원수(size)를, 없으면 0을 userCount에 저장
    const userCount = room ? room.size : 0;

    // 3. 해당 방(roomId)에 있는 모든 유저에게 'room:update' 이벤트를 보냅니다.
    io.to(roomId).emit('room:update', {
        count: userCount
    });
}