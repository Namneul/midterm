const express  = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const AuctionItem = require('../models/AuctionItem'); // MongoDB 모델
const Bid = require('../models/Bid');
const db = require('../models/maria');
const ChatPost = require('../models/ChatPost');


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // public/uploads/ 폴더에 저장
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext); // 123456789.pdf
    }
});

// 2. 파일 필터 (PDF, 이미지만 허용)
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('PDF, JPG, PNG 파일만 업로드 가능합니다.'), false);
    }
};

// 3. Multer 인스턴스 생성
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // (예시) 10MB 제한
});

// ... (router.get('/auth/logout', ...) 다음 등) ...

// [기존] 경매 등록 페이지 (GET)
router.get('/auction/new', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login');
    }
    res.render('auction-new', {
        title: "경매 등록"
    });
});

// [추가] 경매 등록 처리 (POST)
// upload.single('auctionFile') 미들웨어가 파일을 처리하고 req.file에 정보를 담아줍니다.
router.post('/auction', upload.single('auctionFile'), async (req, res) => {
    try {
        // 1. 로그인 확인
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        // 2. 파일 업로드 확인
        if (!req.file) {
            req.flash('error', '자료 파일(PDF, 이미지)을 업로드해야 합니다.');
            return res.redirect('/auction/new');
        }

        // 3. 폼 데이터 및 파일 정보 받기
        const { title, description, startPrice, endDate } = req.body;
        const { path: fileUrl, mimetype } = req.file;
        const {id:sellerId, anonymousNickname: sellerNickname} = req.session.user;

        const newScore = req.session.user.reputationScore + 5;
        await db.query(
            'UPDATE userdata SET reputation_score = ? WHERE Id = ?',
            [newScore, sellerId]
        );

        req.session.user.reputationScore = newScore;

        // 4. 명세서에 맞게 파일 타입 분류
        const fileType = mimetype.startsWith('image') ? 'image' : 'pdf';

        // 5. 익명 닉네임 (임시로 세션 이름 사용, 추후 '평판 기능'시 수정)
        // [cite: 9] 모든 활동은 익명 닉네임으로 이루어져야 함

        // 6. MongoDB에 저장
        const newItem = new AuctionItem({
            title,
            description,
            fileUrl: fileUrl,
            fileType,
            startPrice,
            endDate,
            sellerId: req.session.user.id,
            sellerNickname: sellerNickname,
            sellerReputationSnamshot: newScore,
            currentPrice: startPrice // 시작가를 현재가로 설정
        });
        await newItem.save();

        req.flash('success', '경매가 성공적으로 등록되었습니다. 평판 +5!');
        res.redirect('/community/auction'); // 메인 페이지로 리다이렉트

    } catch (e) {
        console.error(e);
        req.flash('error', '경매 등록 중 오류가 발생했습니다: ' + e.message);
        res.redirect('/auction/new');
    }
});

router.get('/', (req, res) => {
    res.render('community', {
        title:"몰라"
    });
});

router.get('/auction', async (req, res) => {
    try {
        // 1. 페이지네이션 (명세서 필수)
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20; // 한 페이지에 20개
        const skip = (page - 1) * limit;

        // 2. MongoDB에서 데이터 조회
        const items = await AuctionItem.find({ status: 'active' })
            .sort({ createdAt: -1 }) // 최신순
            .skip(skip)
            .limit(limit);

        // 3. 총 페이지 수 계산
        const totalItems = await AuctionItem.countDocuments({ status: 'active' });
        const totalPages = Math.ceil(totalItems / limit);

        // 4. auction.ejs 렌더링
        res.render('auction', { // ⭐️ main.ejs가 아닌 auction.ejs
            title: "경매 목록",
            items: items,
            currentPage: page,
            totalPages: totalPages
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '페이지를 불러오는 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});

router.get('/auction/:id/file', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { id: auctionId } = req.params;
        const item = await AuctionItem.findById(auctionId);

        if (!item) {
            req.flash('error', '파일을 찾을 수 없습니다.');
            return res.redirect('/community/auction');
        }

        // [핵심] 현재 로그인한 사용자가 이 아이템의 판매자인지 확인
        if (req.session.user.id !== item.sellerId) {
            req.flash('error', '판매자만 전체 파일을 볼 수 있습니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }

        // 1. 파일의 실제 서버 경로를 계산
        // __dirname은 현재 파일(routes/)의 경로
        // path.join으로 상위 폴더(..)로 나간 뒤, item.fileUrl(uploads/...) 경로와 합침
        const filePath = path.join(__dirname, '..', item.fileUrl);

        // 2. res.sendFile로 파일 전송
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error(err);
                req.flash('error', '파일을 전송하는 중 오류가 발생했습니다.');
                res.redirect(`/community/auction/${auctionId}`);
            }
        });

    } catch (e) {
        console.error(e);
        res.redirect('/');
    }
});

router.get('/auction/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const item = await AuctionItem.findById(id);

        if (!item) {
            req.flash('error', '해당 경매를 찾을 수 없습니다.');
            return res.redirect('/community/auction'); // 목록으로
        }

        let sellerReputation = 0;
        if(item.sellerId){
            const [rows] = await db.query('SELECT reputation_score FROM userdata WHERE Id = ?', [item.sellerId]);
            if (rows.length) sellerReputation = rows[0].reputation_score;
        }

        let highestBidderReputation = 0;
        if (item.highestBidderId){
            const [rows] = await db.query('SELECT reputation_score FROM userdata WHERE Id = ?',item.highestBidderId);
            if (rows.length) highestBidderReputation = rows[0].reputation_score;
        }

        // (참고) 로그인 여부에 따라 입찰 폼을 보여줄지 결정할 수 있습니다.
        const canBid = req.session.user && (req.session.user.id !== item.sellerId);

        res.render('auction-detail', { // (새로 만들 EJS 파일)
            title: item.title,
            item: item,
            canBid: canBid
        });

    } catch (e) {
        console.error(e);
        // ID 형식이 잘못되었을 때 (e.g., CastError)
        req.flash('error', '경매 상세 정보를 불러오는 데 실패했습니다.');
        res.redirect('/community/auction');
    }
});

router.post('/auction/:id/bid', async (req, res) => {
    const { id: auctionId } = req.params;

    try {
        // 1. 유효성 검사 (로그인, 판매자 본인 여부 등)
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }

        const { id: bidderId, anonymousNickname: bidderNickname } = req.session.user; // 익명 닉네임으로 교체 필요
        if (!bidderNickname){
            req.flash('error', '입찰하려면 익명 닉네임이 필요합니다.')
            return res.redirect(`/community/auction/${auctionId}`);
        }

        const newScore = req.session.user.reputationScore + 5;
        await db.query(
            'UPDATE userdata SET reputation_score = ? WHERE Id = ?',
            [newScore, bidderId]
        );
        req.session.user.reputationScore = newScore;
        const { bidPrice } = req.body; // 폼에서 보낸 입찰가

        const item = await AuctionItem.findById(auctionId);
        if (!item) {
            req.flash('error', '경매를 찾을 수 없습니다.');
            return res.redirect('/community/auction');
        }
        if (item.sellerId === bidderId) {
            req.flash('error', '본인의 경매에는 입찰할 수 없습니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }
        if (parseFloat(bidPrice) <= item.currentPrice) {
            req.flash('error', '현재가보다 높은 금액을 입찰해야 합니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }
        if (item.status !== 'active' || new Date() > new Date(item.endDate)) {
            req.flash('error', '이미 종료된 경매입니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }

        // 2. [필수] 마감 1분 전 입찰 시, 마감 시간 1분 연장
        const now = new Date();
        const oneMinuteBeforeEnd = new Date(new Date(item.endDate).getTime() - 60 * 1000);

        if (now >= oneMinuteBeforeEnd) {
            // 마감 1분 전 -> (현재 시간 + 1분)으로 마감 연장
            item.endDate = new Date(now.getTime() + 60 * 1000);
            req.flash('success', '마감 1분 전 입찰! 경매가 1분 연장됩니다.');
        }

        // 3. MongoDB 업데이트
        // 3a. Bid 컬렉션에 새 입찰 저장
        const newBid = new Bid({
            auctionItem: auctionId,
            bidderId: bidderId,
            bidderNickname: bidderNickname,
            price: bidPrice
        });
        await newBid.save();

        // 3b. AuctionItem 업데이트 (현재가, 최고입찰자, 연장된 마감시간)
        item.currentPrice = bidPrice;
        item.highestBidderId = bidderId;
        item.highestBidderNickname = bidderNickname;
        await item.save();

        // 4. [필수] MariaDB 감사 로그 기록
        await db.query(
            'INSERT INTO BidAuditLog (auction_item_id, bidder_id, bidder_nickname, bid_price, bid_time) VALUES (?, ?, ?, ?, ?)',
            [auctionId, bidderId, bidderNickname, bidPrice, now]
        );

        req.io.to(auctionId).emit('bid:update', {
            newPrice: item.currentPrice,
            bidderNickname: item.highestBidderNickname,
            bidderReputation: newScore
        });

        if (req.flash('success').length === 0) { // 연장 메시지가 없었으면
            req.flash('success', '입찰에 성공했습니다.');
        }
        return res.redirect(`/community/auction/${auctionId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '입찰 중 오류가 발생했습니다: ' + e.message);
        return res.redirect(`/community/auction/${auctionId}`);
    }
});

router.get('/buy-sell', (req, res) => {
    res.render('buy-sell', {
        title:"팝니다 삽니다"
    });
});

router.get('/chat', async (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요한 서비스입니다.');

        // [추가] 2. 로그인 후 돌아올 수 있도록 현재 URL(/community/chat)을 쿼리스트링으로 전달
        return res.redirect('/auth/login?redirect=/community/chat');
    }
    try {
        // [추가] 1. 모든 채팅글을 '익명 번호' 순서로 불러옴
        const posts = await ChatPost.find()
            .sort({ createdAt: 'asc' }); // 오래된 순서

        // [추가] 2. 렌더링 시 post 목록 전달
        res.render('chat', {
            title: "자유수다",
            posts: posts // ⭐️ post 목록 전달
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '채팅방 입장에 실패했습니다.');
        res.redirect('/community');
    }
});

router.post('/chat', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { content } = req.body;
        if (!content) {
            req.flash('error', '내용을 입력하세요.');
            return res.redirect('/community/chat');
        }

        // [핵심] '익명 번호' 생성
        // 1. 현재 DB에서 가장 마지막(가장 큰) 번호를 찾음
        const latestPost = await ChatPost.findOne().sort({ anonymousNumber: -1 });
        // 2. 그 번호에 +1 (없으면 1번으로 시작)
        const newNumber = (latestPost ? latestPost.anonymousNumber : 0) + 1;

        // 3. 새 포스트 저장
        const newPost = new ChatPost({
            content: content,
            authorId: req.session.user.id,
            anonymousNumber: newNumber
        });
        await newPost.save();

        // 4. 다시 채팅방으로 리다이렉트 (새로고침)
        res.redirect('/community/chat');

    } catch (e) {
        console.error(e);
        req.flash('error', '글 작성 중 오류가 발생했습니다.');
        res.redirect('/community/chat');
    }
});
router.get('/chat/:id/delete', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        const post = await ChatPost.findById(postId);

        if (!post) {
            req.flash('error', '삭제할 글이 없습니다.');
            return res.redirect('/community/chat');
        }

        // [핵심] 1. 본인 글인지 확인
        if (post.authorId !== req.session.user.id) {
            req.flash('error', '삭제 권한이 없습니다.');
            return res.redirect('/community/chat');
        }

        // [핵심] 2. 글 삭제
        await ChatPost.findByIdAndDelete(postId);

        // (참고) 삭제 후 '익명 1, 2, 3' 번호가 중간에 비게 되지만,
        // 채팅방 특성상 그냥 둬도 큰 문제는 없습니다.

        res.redirect('/community/chat');

    } catch (e) {
        console.error(e);
        req.flash('error', '삭제 중 오류 발생');
        res.redirect('/community/chat');
    }
});

module.exports = router;