const express  = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const AuctionItem = require('../models/AuctionItem');
const Bid = require('../models/Bid');
const db = require('../models/maria');
const ChatPost = require('../models/ChatPost');
const BoardPost = require('../models/BoardPost');
const BuySellPost = require('../models/BuySellPost');
const Comment = require('../models/Comment');
const Notification = require('../models/Notifications')

/* ---------------------------
 * 공용 헬퍼: Swagger/JSON 분기
 * --------------------------- */
function wantsJSON(req) {
    return req.xhr || req.get('accept')?.includes('application/json');
}
function requireLogin(req, res) {
    if (!req.session?.user) {
        if (wantsJSON(req)) return { handled: true, res: res.status(401).json({ ok:false, message:'로그인이 필요합니다.' }) };
        req.flash('error','로그인이 필요합니다.');
        res.redirect('/auth/login');
        return { handled: true };
    }
    return { handled: false };
}

/**
 * @swagger
 * tags:
 *   - name: Community
 *     description: 커뮤니티 허브/채팅
 *   - name: Auction
 *     description: 경매 기능
 *   - name: BuySell
 *     description: 삽니다/팝니다 게시판
 *
 * components:
 *   securitySchemes:
 *     cookieAuth:
 *       type: apiKey
 *       in: cookie
 *       name: connect.sid
 *   schemas:
 *     AuctionItem:
 *       type: object
 *       properties:
 *         _id: { type: string, example: "673c...abc" }
 *         title: { type: string, example: "중간고사 족보 PDF" }
 *         description: { type: string, example: "전범위 정리 요약본 포함" }
 *         fileUrl: { type: string, example: "uploads/1730088899000.pdf" }
 *         fileType: { type: string, enum: ["image","pdf"] }
 *         startPrice: { type: number, example: 3000 }
 *         currentPrice: { type: number, example: 5000 }
 *         endDate: { type: string, format: date-time }
 *         sellerId: { type: string, example: "appuser01" }
 *         sellerNickname: { type: string, example: "용감한 코알라123" }
 *         status: { type: string, enum: ["active","ended"] }
 *         createdAt: { type: string, format: date-time }
 *     BuySellPost:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         title: { type: string }
 *         content: { type: string }
 *         postType: { type: string, enum: ["buy","sell"] }
 *         price: { type: number }
 *         authorId: { type: string }
 *         authorNickname: { type: string }
 *         createdAt: { type: string, format: date-time }
 *     Comment:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         post: { type: string }
 *         content: { type: string }
 *         authorId: { type: string }
 *         authorNickname: { type: string }
 *         createdAt: { type: string, format: date-time }
 */

/* ---------------------------
 * Multer 설정 (이미지/PDF)
 * --------------------------- */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','application/pdf'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    req.fileValidationError = '이미지(jpeg, png, gif) 또는 PDF 파일만 업로드할 수 있습니다.';
    cb(null, false);
};
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });

/* -------------------------------------
 * 커뮤니티 허브 (최근 활동 합치기)
 * -------------------------------------
 */
/**
 * @swagger
 * /community:
 *   get:
 *     summary: 커뮤니티 허브(최근 활동 Top10)
 *     tags: [Community]
 *     responses:
 *       200:
 *         description: HTML 렌더 또는 JSON 목록
 */
router.get('/', async (req, res) => {
    try {
        const recentAuctions = await AuctionItem.find({ status: 'active' }).sort({ createdAt: -1 }).limit(5);
        const recentPosts = await BoardPost.find().sort({ createdAt: -1 }).limit(5);

        const combined = [
            ...recentAuctions.map(i => ({ ...i.toObject(), type: 'auction', href: `/community/auction/${i._id}` })),
            ...recentPosts.map(p => ({ ...p.toObject(), type: 'board', href: `/board/${p._id}` }))
        ].sort((a,b)=> b.createdAt - a.createdAt).slice(0,10);

        if (wantsJSON(req)) return res.json({ ok:true, recentActivity: combined });
        res.render('community', { title:'Community', recentActivity: combined });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'커뮤니티 허브 로드 실패' });
        req.flash('error','커뮤니티 허브를 불러오는 데 실패했습니다.');
        res.redirect('/');
    }
});

/* ---------------
 * 경매: 등록 폼
 * ---------------
 */
/**
 * @swagger
 * /community/auction/new:
 *   get:
 *     summary: 경매 등록 폼
 *     tags: [Auction]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: HTML 렌더 }
 *       401: { description: 로그인 필요 }
 */
router.get('/auction/new', (req, res) => {
    const r = requireLogin(req, res);
    if (r.handled) return r.res;
    res.render('auction-new', { title:'경매 등록' });
});

/**
 * @swagger
 * /community/buy-sell/{id}/like:
 *   post:
 *     summary: 사고·팔고 게시글 좋아요 / 취소
 *     description: |
 *       로그인한 사용자가 특정 사고·팔고(BuySellPost) 게시글에 대해 좋아요를 누르거나 취소합니다.
 *       같은 사용자가 같은 게시글에 다시 호출하면 **토글**되어 좋아요가 취소됩니다.
 *       요청이 JSON을 원할 경우(JSON/AJAX) JSON을, 그 외에는 HTML 리다이렉트를 반환합니다.
 *     tags:
 *       - BuySell
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 좋아요를 누를 사고·팔고 게시글의 ObjectId
 *         example: "652d5a28e4b2f7f3a1234567"
 *     responses:
 *       200:
 *         description: 좋아요 / 취소 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 action:
 *                   type: string
 *                   description: 좋아요 추가(liked) 또는 취소(unliked)
 *                   example: liked
 *                 likeCount:
 *                   type: integer
 *                   example: 7
 *       401:
 *         description: 인증 실패 (로그인 필요)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "로그인 필요"
 *       404:
 *         description: 게시글을 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "게시글 없음"
 *       500:
 *         description: 서버 내부 오류 (좋아요 처리 실패)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "서버 오류"
 */
router.post('/buy-sell/:id/like', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '좋아요를 누르려면 로그인이 필요합니다.');
            if (wantsJSON(req)) return res.status(401).json({ ok: false, message: '로그인 필요' });
            return res.redirect('/auth/login');
        }

        const postId = req.params.id;
        const userId = req.session.user.id;

        // ⭐️ BuySellPost 모델 사용
        const post = await BuySellPost.findById(postId);
        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            if (wantsJSON(req)) return res.status(404).json({ ok: false, message: '게시글 없음' });
            return res.redirect('/community/buy-sell');
        }

        const likedIndex = post.likes.indexOf(userId);
        let action = '';

        if (likedIndex > -1) {
            post.likes.pull(userId); // 좋아요 취소
            action = 'unliked';
        } else {
            post.likes.push(userId); // 좋아요 추가
            action = 'liked';
        }

        await post.save();

        if (wantsJSON(req)) {
            return res.json({
                ok: true,
                action: action,
                likeCount: post.likes.length
            });
        }

        // ⭐️ 상세 페이지 경로 확인
        res.redirect(`/community/buy-sell/${postId}`);

    } catch (e) {
        console.error("Buy/Sell 좋아요 처리 오류:", e);
        if (wantsJSON(req)) return res.status(500).json({ ok: false, message: '서버 오류' });
        req.flash('error', '좋아요 처리 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.id || ''}`);
    }
});


/* ---------------------------
 * 경매: 등록 (파일 업로드)
 * ---------------------------
 */
/**
 * @swagger
 * /community/auction:
 *   post:
 *     summary: 경매 등록
 *     tags: [Auction]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, startPrice, endDate, auctionFile]
 *             properties:
 *               title: { type: string, example: "족보 PDF" }
 *               description: { type: string, example: "요약 포함" }
 *               startPrice: { type: number, example: 3000 }
 *               endDate: { type: string, example: "2025-12-31T12:00:00.000Z" }
 *               auctionFile:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201: { description: 등록 성공(JSON) / HTML 리다이렉트 }
 *       400: { description: 유효성 오류 }
 *       401: { description: 로그인 필요 }
 */
router.post('/auction', upload.single('auctionFile'), async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        if (req.fileValidationError) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message: req.fileValidationError });
            req.flash('error', req.fileValidationError);
            return res.redirect('/community/auction/new');
        }
        if (!req.file) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'자료 파일(PDF, 이미지) 필수' });
            req.flash('error','자료 파일(PDF, 이미지)을 업로드해야 합니다.');
            return res.redirect('/community/auction/new');
        }

        const { title, description, startPrice, endDate } = req.body;
        const { path: fileUrl, mimetype } = req.file;
        const { id: sellerId, anonymousNickname: sellerNickname } = req.session.user;

        const newScore = (req.session.user.reputationScore ?? 0) + 5;
        await db.query('UPDATE userdata SET reputation_score = ? WHERE Id = ?', [newScore, sellerId]);
        req.session.user.reputationScore = newScore;

        const fileType = mimetype.startsWith('image') ? 'image' : 'pdf';

        const newItem = new AuctionItem({
            title, description,
            fileUrl, fileType,
            startPrice, endDate,
            sellerId, sellerNickname,
            sellerReputationSnamshot: newScore,
            currentPrice: startPrice,
            status: 'active'
        });
        await newItem.save();

        if (wantsJSON(req)) return res.status(201).json({ ok:true, id: newItem._id });
        req.flash('success','경매가 성공적으로 등록되었습니다. 평판 +5!');
        res.redirect('/community/auction');
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message: '경매 등록 중 오류: ' + e.message });
        req.flash('error','경매 등록 중 오류가 발생했습니다: ' + e.message);
        res.redirect('/auction/new');
    }
});

/* -------------------------
 * 경매: 목록 (페이지네이션)
 * -------------------------
 */
/**
 * @swagger
 * /community/auction:
 *   get:
 *     summary: 경매 목록
 *     tags: [Auction]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200: { description: HTML 렌더 또는 JSON 목록 }
 */
router.get('/auction', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20, skip = (page - 1) * limit;

        const items = await AuctionItem.find({ status: 'active' }).sort({ createdAt:-1 }).skip(skip).limit(limit);
        const totalItems = await AuctionItem.countDocuments({ status:'active' });
        const totalPages = Math.ceil(totalItems / limit);

        if (wantsJSON(req)) return res.json({ ok:true, items, currentPage: page, totalPages });
        res.render('auction', { title:'경매 목록', items, currentPage: page, totalPages });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'경매 목록 로드 실패' });
        req.flash('error','페이지를 불러오는 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});

/* -------------------------
 * 경매: 파일 다운로드 권한
 * -------------------------
 */
/**
 * @swagger
 * /community/auction/{id}/file:
 *   get:
 *     summary: 낙찰자/판매자 전용 파일 다운로드
 *     tags: [Auction]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 파일 전송(HTML) }
 *       401: { description: 로그인 필요 }
 *       403: { description: 권한 없음 }
 *       404: { description: 경매 없음 }
 */
router.get('/auction/:id/file', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const item = await AuctionItem.findById(req.params.id);
        if (!item) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'파일을 찾을 수 없습니다.' });
            req.flash('error','파일을 찾을 수 없습니다.');
            return res.redirect('/community/auction');
        }

        const currentUserId = req.session.user.id;
        const isSeller = currentUserId === item.sellerId;
        const isWinner = (item.status === 'ended' && currentUserId === item.highestBidderId);
        if (!isSeller && !isWinner) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'파일 다운로드 권한 없음' });
            req.flash('error','파일을 다운로드할 권한이 없습니다.');
            return res.redirect(`/community/auction/${item._id}`);
        }

        const filePath = path.join(__dirname, '..', item.fileUrl);
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error(err);
                if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'파일 전송 실패' });
                req.flash('error','파일 전송 실패');
                return res.redirect(`/community/auction/${item._id}`);
            }
        });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'파일 요청 처리 실패' });
        res.redirect('/');
    }
});

/* --------------
 * 경매: 상세
 * --------------
 */
/**
 * @swagger
 * /community/auction/{id}:
 *   get:
 *     summary: 경매 상세
 *     tags: [Auction]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: HTML 렌더 또는 JSON 상세 }
 *       404: { description: 없음 }
 */
router.get('/auction/:id', async (req, res) => {
    try {
        const item = await AuctionItem.findById(req.params.id);
        if (!item) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'해당 경매 없음' });
            req.flash('error','해당 경매를 찾을 수 없습니다.');
            return res.redirect('/community/auction');
        }

        const now = new Date();
        if (item.status === 'active' && new Date(item.endDate) < now) {
            item.status = 'ended';
            await item.save();
            const auctionLink = `/community/auction/${item._id}`;

            // (1) 판매자에게 알림
            if (item.sellerId) {
                const sellerNotification = new Notification({
                    userId: item.sellerId,
                    message: `등록하신 경매 '[${item.title}]'이(가) 종료되었습니다.`,
                    link: auctionLink
                });
                await sellerNotification.save();
            }
        }

        let sellerReputation = 0;
        if (item.sellerId) {
            const [rows] = await db.query('SELECT reputation_score FROM userdata WHERE Id = ?', [item.sellerId]);
            if (rows.length) sellerReputation = rows[0].reputation_score;
        }
        let highestBidderReputation = 0;
        if (item.highestBidderId) {
            const [rows] = await db.query('SELECT reputation_score FROM userdata WHERE Id = ?', [item.highestBidderId]);
            if (rows.length) highestBidderReputation = rows[0].reputation_score;
        }

        const canBid = !!(req.session.user && (req.session.user.id !== item.sellerId) && (item.status === 'active'));

        if (wantsJSON(req)) {
            return res.json({ ok:true, item, canBid, sellerReputation, highestBidderReputation });
        }
        res.render('auction-detail', {
            title: item.title,
            item, canBid,
            sellerReputation,
            highestBidderReputation
        });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'경매 상세 로드 실패' });
        req.flash('error','경매 상세 정보를 불러오는 데 실패했습니다.');
        res.redirect('/community/auction');
    }
});

/* ----------
 * 경매: 입찰
 * ---------- */
/**
 * @swagger
 * /community/auction/{id}/bid:
 *   post:
 *     summary: 입찰
 *     tags: [Auction]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bidPrice]
 *             properties:
 *               bidPrice: { type: number, example: 5000 }
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [bidPrice]
 *             properties:
 *               bidPrice: { type: number, example: 5000 }
 *     responses:
 *       200: { description: 성공(JSON) / HTML 리다이렉트 }
 *       400: { description: 유효성 실패 }
 *       401: { description: 로그인 필요 }
 *       403: { description: 본인 경매 등 권한 불가 }
 *       404: { description: 경매 없음 }
 */
router.post('/auction/:id/bid', async (req, res) => {
    const { id: auctionId } = req.params;
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { id: bidderId, anonymousNickname: bidderNickname } = req.session.user;
        if (!bidderNickname) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'익명 닉네임 필요' });
            req.flash('error','입찰하려면 익명 닉네임이 필요합니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }

        const newScore = (req.session.user.reputationScore ?? 0) + 5;
        await db.query('UPDATE userdata SET reputation_score = ? WHERE Id = ?', [newScore, bidderId]);
        req.session.user.reputationScore = newScore;

        const { bidPrice } = req.body;
        const item = await AuctionItem.findById(auctionId);
        if (!item) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'경매 없음' });
            req.flash('error','경매를 찾을 수 없습니다.');
            return res.redirect('/community/auction');
        }
        if (item.sellerId === bidderId) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'본인 경매 입찰 불가' });
            req.flash('error','본인의 경매에는 입찰할 수 없습니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }
        if (parseFloat(bidPrice) <= item.currentPrice) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'현재가보다 높은 금액 필요' });
            req.flash('error','현재가보다 높은 금액을 입찰해야 합니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }
        if (item.status !== 'active' || new Date() > new Date(item.endDate)) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'이미 종료된 경매' });
            req.flash('error','이미 종료된 경매입니다.');
            return res.redirect(`/community/auction/${auctionId}`);
        }

        const now = new Date();
        const oneMinuteBeforeEnd = new Date(new Date(item.endDate).getTime() - 60 * 1000);
        if (now >= oneMinuteBeforeEnd) {
            item.endDate = new Date(now.getTime() + 60 * 1000);
            if (!wantsJSON(req)) req.flash('success','마감 1분 전 입찰! 경매 1분 연장');
        }

        const newBid = new Bid({ auctionItem: auctionId, bidderId, bidderNickname, price: bidPrice });
        await newBid.save();

        item.currentPrice = bidPrice;
        item.highestBidderId = bidderId;
        item.highestBidderNickname = bidderNickname;
        await item.save();

        await db.query(
            'INSERT INTO BidAuditLog (auction_item_id, bidder_id, bidder_nickname, bid_price, bid_time) VALUES (?, ?, ?, ?, ?)',
            [auctionId, bidderId, bidderNickname, bidPrice, now]
        );

        req.io?.to(auctionId).emit('bid:update', {
            newPrice: item.currentPrice,
            bidderNickname: item.highestBidderNickname,
            bidderReputation: newScore,
            newEndDate: item.endDate
        });

        if (wantsJSON(req)) return res.json({ ok:true, newPrice: item.currentPrice, endDate: item.endDate });
        if (req.flash('success').length === 0) req.flash('success','입찰에 성공했습니다.');
        return res.redirect(`/community/auction/${auctionId}`);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'입찰 중 오류: ' + e.message });
        req.flash('error','입찰 중 오류가 발생했습니다: ' + e.message);
        return res.redirect(`/community/auction/${auctionId}`);
    }
});

/* -------------------
 * 삽니다/팝니다: 목록
 * -------------------
 */
/**
 * @swagger
 * /community/buy-sell:
 *   get:
 *     summary: 삽니다/팝니다 목록
 *     tags: [BuySell]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200: { description: HTML 렌더 또는 JSON 목록 }
 */
router.get('/buy-sell', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20, skip = (page - 1) * limit;

        const posts = await BuySellPost.find().sort({ createdAt:-1 }).skip(skip).limit(limit);
        const totalPosts = await BuySellPost.countDocuments();
        const totalPages = Math.ceil(totalPosts / limit);

        if (wantsJSON(req)) return res.json({ ok:true, posts, currentPage: page, totalPages });
        res.render('buy-sell', { title:'삽니다/팝니다', posts, currentPage: page, totalPages });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'Buy/Sell 목록 로드 실패' });
        req.flash('error','게시판을 불러오는 데 실패했습니다.');
        res.redirect('/community');
    }
});

/**
 * @swagger
 * /community/buy-sell/new:
 *   get:
 *     summary: 글쓰기 폼 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: HTML 렌더 }
 *       401: { description: 로그인 필요 }
 */
router.get('/buy-sell/new', (req, res) => {
    const r = requireLogin(req, res);
    if (r.handled) return r.res;
    res.render('buy-sell-new', { title:'새 글 작성 (Buy/Sell)' });
});

/**
 * @swagger
 * /community/buy-sell:
 *   post:
 *     summary: 글 생성 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content, postType, price]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               postType: { type: string, enum: [buy, sell] }
 *               price: { type: number }
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [title, content, postType, price]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               postType: { type: string, enum: [buy, sell] }
 *               price: { type: number }
 *     responses:
 *       201: { description: 생성 성공(JSON) / HTML 리다이렉트 }
 *       400: { description: 유효성 실패 }
 *       401: { description: 로그인 필요 }
 */
router.post('/buy-sell', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { title, content, postType, price } = req.body;
        const { id: authorId, anonymousNickname: authorNickname, reputationScore: authorReputation } = req.session.user;

        if (!title || !content || !postType || !price) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'모든 항목 입력 필요' });
            req.flash('error','모든 항목(분류, 제목, 내용, 가격)을 입력해주세요.');
            return res.redirect('/community/buy-sell/new');
        }

        const newPost = new BuySellPost({ title, content, postType, price, authorId, authorNickname, authorReputation });
        await newPost.save();

        if (wantsJSON(req)) return res.status(201).json({ ok:true, id: newPost._id });
        req.flash('success','글이 성공적으로 등록되었습니다.');
        res.redirect(`/community/buy-sell/${newPost._id}`);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'글 등록 중 오류' });
        req.flash('error','글 등록 중 오류가 발생했습니다.');
        res.redirect('/community/buy-sell/new');
    }
});

/**
 * @swagger
 * /community/buy-sell/{id}:
 *   get:
 *     summary: 글 상세 (Buy/Sell)
 *     tags: [BuySell]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: HTML 렌더 또는 JSON 상세 }
 *       404: { description: 없음 }
 */
router.get('/buy-sell/:id', async (req, res) => {
    try {
        const post = await BuySellPost.findById(req.params.id).populate('comments');
        if (!post) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'게시글 없음' });
            req.flash('error','게시글을 찾을 수 없습니다.');
            return res.redirect('/community/buy-sell');
        }
        if (wantsJSON(req)) return res.json({ ok:true, post });
        res.render('buy-sell-detail', { title: post.title, post });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'상세 로드 실패' });
        req.flash('error','게시글을 불러오는 데 실패했습니다.');
        res.redirect('/community/buy-sell');
    }
});

/**
 * @swagger
 * /community/buy-sell/{id}:
 *   put:
 *     summary: 글 수정 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content, postType, price]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               postType: { type: string, enum: [buy, sell] }
 *               price: { type: number }
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [title, content, postType, price]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               postType: { type: string, enum: [buy, sell] }
 *               price: { type: number }
 *     responses:
 *       200: { description: 수정 성공(JSON) / HTML 리다이렉트 }
 *       401: { description: 로그인 필요 }
 *       403: { description: 권한 없음 }
 *       404: { description: 게시글 없음 }
 */
router.put('/buy-sell/:id', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { id: postId } = req.params;
        const { title, content, postType, price } = req.body;
        const post = await BuySellPost.findById(postId);
        if (!post) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'게시글 없음' });
            req.flash('error','게시글을 찾을 수 없습니다.');
            return res.redirect('/community/buy-sell');
        }
        if (post.authorId !== req.session.user.id) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'수정 권한 없음' });
            req.flash('error','수정 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }
        await BuySellPost.findByIdAndUpdate(postId, { title, content, postType, price });
        if (wantsJSON(req)) return res.json({ ok:true, id: postId });
        req.flash('success','게시글이 수정되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'글 수정 중 오류' });
        req.flash('error','글 수정 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.id}/edit`);
    }
});

/**
 * @swagger
 * /community/buy-sell/{id}:
 *   delete:
 *     summary: 글 삭제 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 삭제 성공(JSON) / HTML 리다이렉트 }
 *       401: { description: 로그인 필요 }
 *       403: { description: 권한 없음 }
 *       404: { description: 게시글 없음 }
 */
router.delete('/buy-sell/:id/delete', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { id: postId } = req.params;
        const post = await BuySellPost.findById(postId);
        if (!post) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'삭제할 글 없음' });
            req.flash('error','삭제할 글이 없습니다.');
            return res.redirect('/community/buy-sell');
        }
        if (post.authorId !== req.session.user.id) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'삭제 권한 없음' });
            req.flash('error','삭제 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        await BuySellPost.findByIdAndDelete(postId);
        await Comment.deleteMany({ post: postId });

        if (wantsJSON(req)) return res.json({ ok:true, id: postId });
        req.flash('success','게시글이 삭제되었습니다.');
        res.redirect('/community/buy-sell');
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'글 삭제 중 오류' });
        req.flash('error','글 삭제 중 오류가 발생했습니다.');
        res.redirect('/community/buy-sell');
    }
});

/* -------------
 * Buy/Sell 댓글
 * ------------- */
/**
 * @swagger
 * /community/buy-sell/{id}/comments:
 *   post:
 *     summary: 댓글 생성 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [content], properties: { content: { type: string } } }
 *         application/x-www-form-urlencoded:
 *           schema: { type: object, required: [content], properties: { content: { type: string } } }
 *     responses:
 *       201: { description: 생성 성공(JSON) / HTML 리다이렉트 }
 *       401: { description: 로그인 필요 }
 *       404: { description: 부모 글 없음 }
 */
router.post('/buy-sell/:id/comments', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { id: postId } = req.params;
        const { content } = req.body;
        const { id: authorId, anonymousNickname: authorNickname } = req.session.user;

        if (!content) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'댓글 내용 필요' });
            req.flash('error','댓글 내용을 입력해주세요.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        const post = await BuySellPost.findById(postId);
        if (!post) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'부모 글 없음' });
            req.flash('error','게시글을 찾을 수 없습니다.');
            return res.redirect('/community/buy-sell');
        }

        const newComment = new Comment({ content, authorId, authorNickname, post: postId });
        await newComment.save();
        post.comments.push(newComment._id);
        await post.save();

        if (post.authorId !== authorId) {
            const commentNotification = new Notification({
                userId: post.authorId,
                message: `'${post.title}' (사고팔고) 게시글에 ${authorNickname} 님이 댓글을 남겼습니다.`,
                link: `/community/buy-sell/${postId}` // ⭐️ 경로 확인
            });
            await commentNotification.save();
        }

        if (wantsJSON(req)) return res.status(201).json({ ok:true, id: newComment._id });
        req.flash('success','댓글이 등록되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'댓글 등록 오류' });
        req.flash('error','댓글 등록 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.id}`);
    }
});

/**
 * @swagger
 * /community/buy-sell/{postId}/comments/{commentId}:
 *   put:
 *     summary: 댓글 수정 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [content], properties: { content: { type: string } } }
 *         application/x-www-form-urlencoded:
 *           schema: { type: object, required: [content], properties: { content: { type: string } } }
 *     responses:
 *       200: { description: 수정 성공 }
 *       401: { description: 로그인 필요 }
 *       403: { description: 권한 없음 }
 *       404: { description: 댓글 없음 }
 */
router.put('/buy-sell/:postId/comments/:commentId', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { postId, commentId } = req.params;
        const { content } = req.body;

        if (!content) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'댓글 내용 필요' });
            req.flash('error','댓글 내용을 입력해주세요.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        const comment = await Comment.findById(commentId);
        if (!comment) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'수정할 댓글 없음' });
            req.flash('error','수정할 댓글이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }
        if (comment.authorId !== req.session.user.id) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'댓글 수정 권한 없음' });
            req.flash('error','댓글 수정 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        await Comment.findByIdAndUpdate(commentId, { content });
        if (wantsJSON(req)) return res.json({ ok:true, id: commentId });
        req.flash('success','댓글이 수정되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'댓글 수정 오류' });
        req.flash('error','댓글 수정 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${req.params.postId}`);
    }
});

/**
 * @swagger
 * /community/buy-sell/{postId}/comments/{commentId}/delete:
 *   delete:
 *     summary: 댓글 삭제 (Buy/Sell)
 *     tags: [BuySell]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 삭제 성공 }
 *       401: { description: 로그인 필요 }
 *       403: { description: 권한 없음 }
 *       404: { description: 댓글 없음 }
 */
router.delete('/buy-sell/:postId/comments/:commentId/delete', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { postId, commentId } = req.params;
        const comment = await Comment.findById(commentId);
        if (!comment) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'삭제할 댓글 없음' });
            req.flash('error','삭제할 댓글이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }
        if (comment.authorId !== req.session.user.id) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'삭제 권한 없음' });
            req.flash('error','삭제 권한이 없습니다.');
            return res.redirect(`/community/buy-sell/${postId}`);
        }

        await Comment.findByIdAndDelete(commentId);
        await BuySellPost.findByIdAndUpdate(postId, { $pull: { comments: commentId } });

        if (wantsJSON(req)) return res.json({ ok:true, id: commentId });
        req.flash('success','댓글이 삭제되었습니다.');
        res.redirect(`/community/buy-sell/${postId}`);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'댓글 삭제 오류' });
        req.flash('error','댓글 삭제 중 오류가 발생했습니다.');
        res.redirect(`/community/buy-sell/${postId}`);
    }
});

/* --------
 * 채팅방
 * -------- */
/**
 * @swagger
 * /community/chat:
 *   get:
 *     summary: 자유수다(채팅) 목록
 *     tags: [Community]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: HTML 렌더 또는 JSON 목록 }
 *       401: { description: 로그인 필요 }
 */
router.get('/chat', async (req, res) => {
    if (!req.session?.user) {
        if (wantsJSON(req)) return res.status(401).json({ ok:false, message:'로그인이 필요합니다.' });
        req.flash('error','로그인이 필요한 서비스입니다.');
        return res.redirect('/auth/login?redirect=/community/chat');
    }
    try {
        const posts = await ChatPost.find().sort({ createdAt: 'asc' });
        if (wantsJSON(req)) return res.json({ ok:true, posts });
        res.render('chat', { title:'자유수다', posts });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'채팅 목록 로드 실패' });
        req.flash('error','채팅방 입장에 실패했습니다.');
        res.redirect('/community');
    }
});

/**
 * @swagger
 * /community/chat:
 *   post:
 *     summary: 자유수다 글 작성
 *     tags: [Community]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [content], properties: { content: { type: string } } }
 *         application/x-www-form-urlencoded:
 *           schema: { type: object, required: [content], properties: { content: { type: string } } }
 *     responses:
 *       201: { description: 생성 성공 }
 *       400: { description: 내용 없음 }
 *       401: { description: 로그인 필요 }
 */
router.post('/chat', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { content } = req.body;
        if (!content) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'내용 필요' });
            req.flash('error','내용을 입력하세요.');
            return res.redirect('/community/chat');
        }

        const latestPost = await ChatPost.findOne().sort({ anonymousNumber: -1 });
        const newNumber = (latestPost ? latestPost.anonymousNumber : 0) + 1;

        const newPost = new ChatPost({
            content,
            authorId: req.session.user.id,
            anonymousNumber: newNumber
        });
        await newPost.save();

        if (wantsJSON(req)) return res.status(201).json({ ok:true, id: newPost._id, anonymousNumber: newNumber });
        res.redirect('/community/chat');
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'글 작성 오류' });
        req.flash('error','글 작성 중 오류가 발생했습니다.');
        res.redirect('/community/chat');
    }
});

/**
 * @swagger
 * /community/chat/{id}/delete:
 *   get:
 *     summary: 자유수다 글 삭제 (GET 트리거)
 *     tags: [Community]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 삭제 성공(JSON) / HTML 리다이렉트 }
 *       401: { description: 로그인 필요 }
 *       403: { description: 권한 없음 }
 *       404: { description: 글 없음 }
 */
router.get('/chat/:id/delete', async (req, res) => {
    try {
        const r = requireLogin(req, res);
        if (r.handled) return r.res;

        const { id: postId } = req.params;
        const post = await ChatPost.findById(postId);
        if (!post) {
            if (wantsJSON(req)) return res.status(404).json({ ok:false, message:'삭제할 글 없음' });
            req.flash('error','삭제할 글이 없습니다.');
            return res.redirect('/community/chat');
        }
        if (post.authorId !== req.session.user.id) {
            if (wantsJSON(req)) return res.status(403).json({ ok:false, message:'삭제 권한 없음' });
            req.flash('error','삭제 권한이 없습니다.');
            return res.redirect('/community/chat');
        }

        await ChatPost.findByIdAndDelete(postId);
        if (wantsJSON(req)) return res.json({ ok:true, id: postId });
        res.redirect('/community/chat');
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'삭제 중 오류' });
        req.flash('error','삭제 중 오류 발생');
        res.redirect('/community/chat');
    }
});

module.exports = router;
