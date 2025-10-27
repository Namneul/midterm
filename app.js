const express = require('express');
const app = express();
const path = require('path');
const port = 3000;
const ejsMate = require('ejs-mate');
const maria = require('./models/maria');
const mongoose = require('mongoose');
const session = require('express-session');
const flash = require('connect-flash');

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
    res.locals.currentUser = req.session.user || null;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', mainRouter);
app.use('/community', communityRouter);
app.use('/board', boardRouter);

io.on('connection', (socket) => {
    console.log('새로운 유저가 접속했습니다.');

    // 클라이언트가 특정 경매방(room)에 입장
    socket.on('join:room', (auctionId) => {
        socket.join(auctionId); // auctionId 이름의 방에 조인
        console.log(`유저가 ${auctionId} 방에 입장했습니다.`);
    });

    socket.on('disconnect', () => {
        console.log('유저가 접속 해제했습니다.');
    });
});

server.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});