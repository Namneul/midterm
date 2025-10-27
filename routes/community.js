const express  = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const AuctionItem = require('../models/AuctionItem'); // MongoDB 모델
const Bid = require('../models/Bid');
const db = require('../models/maria');
const ChatPost = require('../models/ChatPost');
const BoardPost = require('../models/BoardPost');
const BuySellPost = require('../models/BuySellPost');
const Comment = require('../models/Comment');


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
    // 허용할 MimeType 목록
    // 이미지 (jpeg, png, gif), PDF
    const allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/pdf'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
        // 1. 허용된 파일이면, 통과 (저장 O)
        cb(null, true);
    } else {
        // 2. 거부된 파일이면, 에러 메시지를 req 객체에 심고, (저장 X)
        req.fileValidationError = "이미지(jpeg, png, gif) 또는 PDF 파일만 업로드할 수 있습니다.";
        cb(null, false);
    }
};

// [수정] 2. Multer 설정 객체에 'fileFilter' 옵션 추가
const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // (20MB 제한 예시)
    fileFilter: fileFilter // ⭐️ 파일 필터 적용
});

router.get('/', async (req, res) => { // 'async' 추가
    try {
        // 1. 최신 경매 5개 가져오기
        const recentAuctions = await AuctionItem.find({ status: 'active' })
            .sort({ createdAt: -1 })
            .limit(5);

        // 2. 최신 게시글 5개 가져오기
        const recentPosts = await BoardPost.find()
            .sort({ createdAt: -1 })
            .limit(5);

        // 3. 두 배열을 합치고, EJS에서 구분할 'type'과 'href' 추가
        const combined = [
            ...recentAuctions.map(item => ({
                ...item.toObject(),
                type: 'auction',
                href: `/community/auction/${item._id}`
            })),
            ...recentPosts.map(post => ({
                ...post.toObject(),
                type: 'board',
                href: `/board/${post._id}`
            }))
        ];

        // 4. 합친 배열을 '최신순(createdAt)'으로 다시 정렬
        combined.sort((a, b) => b.createdAt - a.createdAt);

        // 5. 정렬된 목록에서 상위 10개만 선택
        const recentActivity = combined.slice(0, 10);

        // 6. EJS에 'recentActivity' 배열 전달
        res.render('community', {
            title: "Community",
            recentActivity: recentActivity
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '커뮤니티 허브를 불러오는 데 실패했습니다.');
        res.redirect('/');
    }
});


router.get('/auction/new', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login');
    }
    res.render('auction-new', {
        title: "경매 등록"
    });
});

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
            return res.redirect('/community/auction/new');
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

        const currentUserId = req.session.user.id;

        // [핵심] 현재 로그인한 사용자가 이 아이템의 판매자인지 확인
        const isSeller = currentUserId === item.sellerId;
        const isWinner = (item.status === 'ended' && currentUserId === item.highestBidderId);

        if (isSeller || isWinner) {
            // [권한 있음] 파일 전송
            const filePath = path.join(__dirname, '..', item.fileUrl);
            res.sendFile(filePath, (err) => {
                // ... (파일 전송 오류 처리) ...
            });
        } else {
            // [권한 없음]
            req.flash('error', '파일을 다운로드할 권한이 없습니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }

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
            return res.redirect('/community/auction');
        }

        // [경매 종료 로직]
        const now = new Date();
        if (item.status === 'active' && new Date(item.endDate) < now) {
            item.status = 'ended';
            await item.save();
            console.log(`[경매 종료] 경매 ${item._id}가 'ended' 상태로 변경됨.`);
        }

        // ----------------------------------------------------
        // 👇 [수정] 이 부분이 빠져있을 겁니다. (점수 조회)
        // ----------------------------------------------------
        // 1. 판매자의 '최신' 평판 점수 조회
        let sellerReputation = 0;
        if (item.sellerId) {
            const [rows] = await db.query('SELECT reputation_score FROM userdata WHERE Id = ?', [item.sellerId]);
            if (rows.length) sellerReputation = rows[0].reputation_score;
        }

        // 2. '현재 최고 입찰자'의 '최신' 평판 점수 조회
        // (EJS에서 'highestBidderReputation'도 사용하므로 같이 조회해야 함)
        let highestBidderReputation = 0;
        if (item.highestBidderId) {
            const [rows] = await db.query('SELECT reputation_score FROM userdata WHERE Id = ?', [item.highestBidderId]);
            if (rows.length) highestBidderReputation = rows[0].reputation_score;
        }
        // ----------------------------------------------------
        // 👆 [수정] 여기까지 입니다.
        // ----------------------------------------------------

        const canBid = req.session.user &&
            (req.session.user.id !== item.sellerId) &&
            (item.status === 'active');

        // [수정] 3. 렌더링 시 조회한 점수를 EJS로 전달
        res.render('auction-detail', {
            title: item.title,
            item: item,
            canBid: canBid,
            sellerReputation: sellerReputation, // ⭐️ 전달
            highestBidderReputation: highestBidderReputation // ⭐️ 전달
        });

    } catch (e) {
        console.error(e);
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
            bidderReputation: newScore,
            newEndDate: item.endDate
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

router.get('/buy-sell', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20;
        const skip = (page - 1) * limit;

        // ⭐️ BuySellPost 모델 사용
        const posts = await BuySellPost.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalPosts = await BuySellPost.countDocuments();
        const totalPages = Math.ceil(totalPosts / limit);

        res.render('buy-sell', { // ⭐️ 3단계: views/buy-sell.ejs (신규)
            title: "삽니다/팝니다",
            posts: posts,
            currentPage: page,
            totalPages: totalPages
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '게시판을 불러오는 데 실패했습니다.');
        res.redirect('/community');
    }
});

// GET /community/buy-sell/new - 글쓰기 폼
router.get('/buy-sell/new', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/community/buy-sell/new');
    }
    res.render('buy-sell-new', { // ⭐️ 3단계: views/buy-sell-new.ejs (신규)
        title: "새 글 작성 (Buy/Sell)"
    });
});

// POST /community/buy-sell - 글 생성 처리
router.post('/buy-sell', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        // ⭐️ postType, price 추가
        const { title, content, postType, price } = req.body;
        const {
            id: authorId,
            anonymousNickname: authorNickname,
            reputationScore: authorReputation
        } = req.session.user;

        // ⭐️ 유효성 검사 추가
        if (!title || !content || !postType || !price) {
            req.flash('error', '모든 항목(분류, 제목, 내용, 가격)을 입력해주세요.');
            return res.redirect('/community/buy-sell/new');
        }

        const newPost = new BuySellPost({
            title,
            content,
            postType, // ⭐️ 'sell' or 'buy'
            price,    // ⭐️ 가격
            authorId,
            authorNickname,
            authorReputation
        });

        await newPost.save();

        req.flash('success', '글이 성공적으로 등록되었습니다.');
        // ⭐️ 상세 페이지로 이동
        res.redirect(`/community/buy-sell/${newPost._id}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '글 등록 중 오류가 발생했습니다.');
        res.redirect('/community/buy-sell/new');
    }
});

// GET /community/buy-sell/:id - 글 상세보기 (댓글 포함)
router.get('/buy-sell/:id', async (req, res) => {
    try {
        // ⭐️ BuySellPost 모델 사용
        const post = await BuySellPost.findById(req.params.id)
            .populate('comments'); // ⭐️ 댓글 정보 로드

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/community/buy-sell');
        }

        res.render('buy-sell-detail', { // ⭐️ 3단계: views/buy-sell-detail.ejs (신규)
            title: post.title,
            post: post
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '게시글을 불러오는 데 실패했습니다.');
        res.redirect('/community/buy-sell');
    }
});

router.get('/buy-sell/:id/edit', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const post = await BuySellPost.findById(req.params.id);

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/community/buy-sell');
        }

        if (post.authorId !== req.session.user.id) {
            req.flash('error', '수정 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${req.params.id}`);
        }

        // ⭐️ 2단계: 'views/buy-sell-edit.ejs' 렌더링
        res.render('buy-sell-edit', {
            title: "게시글 수정 (Buy/Sell)",
            post: post
        });

    } catch (e) {
        console.error(e);
        res.redirect(`/community/buy-sell/${req.params.id}`);
    }
});

router.put('/buy-sell/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        // ⭐️ postType, price 추가
        const { title, content, postType, price } = req.body;

        const post = await BuySellPost.findById(postId);

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/community/buy-sell');
        }

        if (post.authorId !== req.session.user.id) {
            req.flash('error', '수정 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        // [DB] ⭐️ 'findByIdAndUpdate'로 수정 (4개 항목)
        await BuySellPost.findByIdAndUpdate(postId, {
            title: title,
            content: content,
            postType: postType,
            price: price
        });

        req.flash('success', '게시글이 수정되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`); // ⭐️ 상세 페이지로 복귀

    } catch (e) {
        console.error(e);
        req.flash('error', '글 수정 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.id}/edit`);
    }
});

router.delete('/buy-sell/:id/delete', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        const post = await BuySellPost.findById(postId);

        if (!post) {
            req.flash('error', '삭제할 글이 없습니다.');
            return res.redirect('/community/buy-sell');
        }
        if (post.authorId !== req.session.user.id) {
            req.flash('error', '삭제 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        await BuySellPost.findByIdAndDelete(postId);
        await Comment.deleteMany({ post: postId }); // ⭐️ 댓글도 함께 삭제

        req.flash('success', '게시글이 삭제되었습니다.');
        res.redirect('/community/buy-sell');

    } catch (e) {
        console.error(e);
        req.flash('error', '글 삭제 중 오류가 발생했습니다.');
        res.redirect('/community/buy-sell');
    }
});

router.post('/buy-sell/:id/comments', async (req, res) => {
    try {
        if (!req.session.user) { /* ... (로그인 체크) ... */ }

        const { id: postId } = req.params;
        const { content } = req.body;
        const { id: authorId, anonymousNickname: authorNickname } = req.session.user;

        if (!content) { /* ... (내용 체크) ... */ }

        const post = await BuySellPost.findById(postId); // ⭐️ 부모 Post (BuySellPost)
        if (!post) { /* ... (부모 글 체크) ... */ }

        const newComment = new Comment({ content, authorId, authorNickname, post: postId });
        await newComment.save();

        post.comments.push(newComment._id);
        await post.save();

        req.flash('success', '댓글이 등록되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 등록 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.id}`);
    }
});

router.put('/buy-sell/:postId/comments/:commentId', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { postId, commentId } = req.params;
        const { content } = req.body;

        if (!content) {
            req.flash('error', '댓글 내용을 입력해주세요.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        const comment = await Comment.findById(commentId);

        if (!comment) {
            req.flash('error', '수정할 댓글이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        if (comment.authorId !== req.session.user.id) {
            req.flash('error', '댓글 수정 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        // [DB] 댓글 내용(content) 업데이트
        await Comment.findByIdAndUpdate(commentId, { content: content });

        req.flash('success', '댓글이 수정되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 수정 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.postId}`);
    }
});

router.delete('/buy-sell/:postId/comments/:commentId/delete', async (req, res) => {
    try {
        if (!req.session.user) { /* ... (로그인 체크) ... */ }

        const { postId, commentId } = req.params;
        const comment = await Comment.findById(commentId);

        if (!comment) { /* ... (댓글 체크) ... */ }
        if (comment.authorId !== req.session.user.id) { /* ... (권한 체크) ... */ }

        await Comment.findByIdAndDelete(commentId);

        // ⭐️ 부모 Post (BuySellPost)의 comments 배열에서 참조 ID 제거
        await BuySellPost.findByIdAndUpdate(postId, {
            $pull: { comments: commentId }
        });

        req.flash('success', '댓글이 삭제되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 삭제 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${postId}`);
    }
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