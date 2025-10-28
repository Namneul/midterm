const express  = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../models/maria');
const AuctionItem = require('../models/AuctionItem')
const BoardPost = require('../models/BoardPost');
const Comment = require('../models/Comment')
const BuySellPost = require('../models/BuySellPost');
const multer = require('multer');
const path = require('path');
const Notification = require('../models/Notifications')

function wantsJSON(req) {
    return req.xhr || req.get('accept')?.includes('application/json');
}

function generateRandomNickname(){
    const adjectives = ["친절한", "용감한", "배고픈", "졸린", "행복한", "재빠른", "빛나는"];
    const nouns = ["코알라", "다람쥐", "호랑이", "고양이", "개발자", "학생", "유니콘"];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}${Math.floor(Math.random() * 1000)}`;
}
const profileImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // public/uploads/profile_images 폴더에 저장
        cb(null, 'uploads/profile_images/');
    },
    filename: (req, file, cb) => {
        // 파일명: 유저ID_현재시간.확장자 (예: testuser_1678886400000.jpg)
        const userId = req.session.user.id; // 세션에서 유저 ID 가져오기
        const ext = path.extname(file.originalname);
        cb(null, `${userId}_${Date.now()}${ext}`);
    }
});

const profileImageFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        // 허용되지 않은 파일이면 에러 메시지를 req 객체에 저장
        req.fileValidationError = "이미지 파일(JPG, PNG, GIF)만 업로드할 수 있습니다.";
        cb(null, false);
    }
};

const uploadProfileImage = multer({
    storage: profileImageStorage,
    fileFilter: profileImageFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 예: 5MB 제한
});


/**
 * @swagger
 * /search:
 *   get:
 *     summary: 통합 검색
 *     description: |
 *       자유게시판(BoardPost), 사고팔고(BuySellPost), 경매(AuctionItem), 사용자(Userdata)에서
 *       입력된 검색어(`q`)를 기준으로 통합 검색을 수행합니다.
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: false
 *         description: 검색어 (없으면 빈 결과 반환)
 *     responses:
 *       200:
 *         description: 검색 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: object
 *                   properties:
 *                     board:
 *                       type: array
 *                       description: 자유게시판 게시글 결과
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "652d56c2e2a1f2e8c9f8d23a"
 *                           title:
 *                             type: string
 *                             example: "중간고사 기출 공유합니다"
 *                           content:
 *                             type: string
 *                             example: "2024년도 중간고사 요약본입니다."
 *                           link:
 *                             type: string
 *                             example: "/board/652d56c2e2a1f2e8c9f8d23a"
 *                     buySell:
 *                       type: array
 *                       description: 사고팔고 게시글 결과
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           content:
 *                             type: string
 *                           link:
 *                             type: string
 *                             example: "/community/buy-sell/652d56c2e2a1f2e8c9f8d23a"
 *                     auction:
 *                       type: array
 *                       description: 경매 항목 결과
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           description:
 *                             type: string
 *                           link:
 *                             type: string
 *                             example: "/community/auction/652d56c2e2a1f2e8c9f8d23a"
 *                     user:
 *                       type: array
 *                       description: 사용자 닉네임 검색 결과 (MariaDB)
 *                       items:
 *                         type: object
 *                         properties:
 *                           Id:
 *                             type: integer
 *                             example: 12
 *                           anonymous_nickname:
 *                             type: string
 *                             example: "공대생123"
 *       400:
 *         description: 잘못된 요청 (검색어 없음)
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
 *                   example: "검색어가 없습니다."
 *       500:
 *         description: 서버 내부 오류
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
 *                   example: "검색 중 서버 오류가 발생했습니다."
 */
router.get('/search', async (req, res) => {
    const query = req.query.q;

    // 검색어가 없으면 빈 결과 페이지 렌더링
    if (!query) {
        return res.render('search-results', {
            title: "통합 검색",
            query: "",
            results: { board: [], buySell: [], auction: [], user: [] },
            user: req.session.user
        });
    }

    try {
        const regexQuery = { $regex: query, $options: 'i' };

        const boardResultsPromise = BoardPost.find({
            $or: [{ title: regexQuery }, { content: regexQuery }]
        }).limit(10).lean();

        const buySellResultsPromise = BuySellPost.find({
            $or: [{ title: regexQuery }, { content: regexQuery }]
        }).limit(10).lean();

        const auctionResultsPromise = AuctionItem.find({
            $or: [{ title: regexQuery }, { description: regexQuery }]
        }).limit(10).lean();

        const userResultsPromise = db.query(
            'SELECT Id, anonymous_nickname FROM userdata WHERE anonymous_nickname LIKE ? LIMIT 5',
            [`%${query}%`]
        );

        const [boardResults, buySellResults, auctionResults, [userResults]] = await Promise.all([
            boardResultsPromise,
            buySellResultsPromise,
            auctionResultsPromise,
            userResultsPromise
        ]);

        const results = {
            board: boardResults.map(post => ({ ...post, link: `/board/${post._id}` })),
            buySell: buySellResults.map(post => ({ ...post, link: `/community/buy-sell/${post._id}` })),
            auction: auctionResults.map(item => ({ ...item, link: `/community/auction/${item._id}` })),
            user: userResults
        };

        if (wantsJSON(req)) {
            return res.json({ ok: true, results });
        }

        res.render('search-results', {
            title: `"${query}" 검색 결과`,
            query: query,
            results: results,
            user: req.session.user
        });

    } catch (e) {
        console.error("통합 검색 오류:", e);
        if (wantsJSON(req)) {
            return res.status(500).json({ ok: false, message: '검색 중 서버 오류가 발생했습니다.' });
        }
        req.flash('error', '검색 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});


/**
 * @swagger
 * tags:
 *   - name: Profile
 *     description: 사용자 프로필 및 계정 관련 API
 */

/**
 * @swagger
 * /profile/password-change:
 *   get:
 *     summary: 비밀번호 변경 페이지 요청
 *     description: 로그인된 사용자가 비밀번호 변경 화면을 요청합니다.
 *                  Swagger "Try it out"에서는 JSON 형태로 로그인 상태를 반환합니다.
 *     tags: [Profile]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: 성공적으로 페이지(HTML) 또는 상태(JSON) 반환
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "비밀번호 변경 페이지 접근 가능"
 *       401:
 *         description: 로그인 필요 (미로그인 시)
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
 *                   example: "로그인이 필요합니다."
 */
router.get('/profile/password-change', (req, res) => {
    const wantsJSON = req.get('accept')?.includes('application/json');

    // 1. 로그인 여부 확인
    if (!req.session.user) {
        if (wantsJSON) {
            // Swagger "Try it out" 시 JSON 응답
            return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
        }
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/profile/password-change');
    }

    // 2. 로그인된 경우
    if (wantsJSON) {
        // Swagger에서는 HTML 대신 JSON 반환
        return res.json({ ok: true, message: '비밀번호 변경 페이지 접근 가능' });
    }

    // 3. 실제 웹페이지 렌더링
    res.render('profile-password-change', {
        title: "비밀번호 변경"
        // currentUser는 layout.ejs에서 전역 사용 가능
    });
});


/**
 * @swagger
 * /profile/password-change:
 *   put:
 *     summary: 비밀번호 변경
 *     description: |
 *       로그인한 사용자가 자신의 비밀번호를 변경합니다.
 *       현재 비밀번호를 확인한 뒤 새 비밀번호를 해싱하여 DB에 업데이트합니다.
 *     tags:
 *       - User
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *               - newPasswordConfirm
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 example: "oldPassword123!"
 *                 description: 현재 비밀번호
 *               newPassword:
 *                 type: string
 *                 example: "newSecurePass!456"
 *                 description: 새 비밀번호
 *               newPasswordConfirm:
 *                 type: string
 *                 example: "newSecurePass!456"
 *                 description: 새 비밀번호 확인
 *     responses:
 *       200:
 *         description: 비밀번호 변경 성공 (리다이렉트)
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "/profile 페이지로 리다이렉트됨"
 *       400:
 *         description: 잘못된 요청 (입력 누락 또는 불일치)
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
 *                   example: "새 비밀번호와 확인 비밀번호가 일치하지 않습니다."
 *       401:
 *         description: 인증 실패 (세션 만료 또는 비밀번호 불일치)
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
 *                   example: "현재 비밀번호가 일치하지 않습니다."
 *       404:
 *         description: 사용자 정보를 찾을 수 없음
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
 *                   example: "사용자 정보를 찾을 수 없습니다."
 *       500:
 *         description: 서버 내부 오류
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
 *                   example: "비밀번호 변경 중 오류가 발생했습니다."
 */
router.put('/profile/password-change', async (req, res) => {
    try {
        // 1. 로그인 확인
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다. 다시 로그인해주세요.');
            return res.redirect('/auth/login');
        }

        const userId = req.session.user.id;
        const { currentPassword, newPassword, newPasswordConfirm } = req.body;

        // 2. 입력값 검증
        if (!currentPassword || !newPassword || !newPasswordConfirm) {
            req.flash('error', '모든 필드를 입력해주세요.');
            return res.redirect('/profile/password-change');
        }
        if (newPassword !== newPasswordConfirm) {
            req.flash('error', '새 비밀번호와 확인 비밀번호가 일치하지 않습니다.');
            return res.redirect('/profile/password-change');
        }

        // 3. 현재 비밀번호 확인
        const [rows] = await db.query('SELECT password_hash FROM userdata WHERE Id = ?', [userId]);
        if (rows.length === 0) {
            req.flash('error', '사용자 정보를 찾을 수 없습니다.');
            return res.redirect('/profile');
        }

        const user = rows[0];
        const match = await bcrypt.compare(currentPassword, user.password_hash);

        if (!match) {
            req.flash('error', '현재 비밀번호가 일치하지 않습니다.');
            return res.redirect('/profile/password-change');
        }

        // 4. 새 비밀번호 해싱
        const newHash = await bcrypt.hash(newPassword, 12);

        // 5. DB 업데이트
        await db.query('UPDATE userdata SET password_hash = ? WHERE Id = ?', [newHash, userId]);

        // 6. 성공 처리
        req.flash('success', '비밀번호가 성공적으로 변경되었습니다.');
        res.redirect('/profile');
    } catch (e) {
        console.error(e);
        req.flash('error', '비밀번호 변경 중 오류가 발생했습니다.');
        res.redirect('/profile/password-change');
    }
});




/**
 * @swagger
 * /:
 *   get:
 *     summary: 메인 페이지 (경매 목록)
 *     description: 현재 진행 중인 경매 목록을 페이지네이션하여 반환합니다.
 *     tags: [Main]
 *     parameters:
 *       - name: page
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 현재 페이지 번호
 *     responses:
 *       200:
 *         description: 메인 페이지 렌더링 성공
 *       500:
 *         description: 서버 오류
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20;
        const skip = (page - 1) * limit;
        const items = await AuctionItem.find({ status: 'active' })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const totalItems = await AuctionItem.countDocuments({ status: 'active' });
        const totalPages = Math.ceil(totalItems / limit);

        res.render('main', {
            title: "메인",
            items,
            currentPage: page,
            totalPages
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '경매 목록을 불러오는 데 실패했습니다.');
        res.render('main', { title: "메인", items: [], currentPage: 1, totalPages: 1 });
    }
});

/**
 * @swagger
 * /auth/login:
 *   get:
 *     summary: 로그인 페이지
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 로그인 페이지 렌더링 성공
 */
router.get('/auth/login', (req, res) => {
    res.render('login-signup', {
        title: '로그인',
        mode: 'login',
        redirect: req.query.redirect
    });
});

/**
 * @swagger
 * /auth/logout:
 *   get:
 *     summary: 로그아웃
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: 로그아웃 후 메인 페이지로 리다이렉트
 */
router.get('/auth/logout', (req, res) => {
    req.flash('success', '로그아웃되었습니다.');
    req.session.destroy(err => {
        if (err) {
            console.error(err);
            return res.redirect('/auth/login?error=logout-failed');
        }
        res.clearCookie('connect.sid');
        return res.redirect('/');
    });
});

/**
 * @swagger
 * /auth/signup:
 *   get:
 *     summary: 회원가입 페이지
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 회원가입 페이지 렌더링 성공
 */
router.get('/auth/signup', (req, res) => {
    res.render('login-signup', {
        title: '회원가입',
        mode:'signup'
    });
});

/**
 * @swagger
 * /profile:
 *   get:
 *     summary: 마이페이지
 *     tags: [Profile]
 *     responses:
 *       200:
 *         description: 마이페이지 렌더링 성공
 *       401:
 *         description: 로그인 필요
 */
router.get('/profile', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login?redirect=/profile');
        }
        const userId = req.session.user.id;
        const myAuctions = await AuctionItem.find({ sellerId: userId }).sort({ createdAt: -1 });
        const myBidsWon = await AuctionItem.find({ highestBidderId: userId, status: 'ended' }).sort({ endDate: -1 });
        const myPosts = await BoardPost.find({ authorId: userId }).sort({ createdAt: -1 });

        res.render('profile', {
            title: "마이페이지",
            myAuctions,
            myBidsWon,
            myPosts
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '프로필을 불러오는 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});

/**
 * @swagger
 * /profile/reroll-nickname:
 *   put:
 *     summary: 익명 닉네임 재생성 (닉네임 리롤)
 *     description: |
 *       로그인한 사용자가 자신의 익명 닉네임을 랜덤으로 재생성합니다.
 *       닉네임은 7일에 한 번만 변경할 수 있으며, DB의 `userdata.anonymous_nickname`과 `last_nickname_change` 필드가 업데이트됩니다.
 *       닉네임은 중복되지 않도록 자동으로 10회까지 유니크 검사를 수행합니다.
 *     tags:
 *       - User
 *     responses:
 *       200:
 *         description: 닉네임 변경 성공 (리다이렉트)
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "/profile 페이지로 리다이렉트됨"
 *       400:
 *         description: 잘못된 요청 (쿨타임 미경과 또는 닉네임 생성 실패)
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
 *                   example: "닉네임은 7일에 한 번만 변경할 수 있습니다. (약 3일 남음)"
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
 *                   example: "로그인이 필요합니다."
 *       404:
 *         description: 사용자 정보를 찾을 수 없음
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
 *                   example: "사용자 정보를 찾을 수 없습니다."
 *       500:
 *         description: 서버 내부 오류 (닉네임 리롤 실패)
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
 *                   example: "닉네임 변경 중 오류가 발생했습니다."
 */
router.put('/profile/reroll-nickname', async (req, res) => {
    try {
        // 1. 로그인 확인
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const userId = req.session.user.id;

        // 2. 마지막 변경 시간 조회
        const [rows] = await db.query('SELECT last_nickname_change FROM userdata WHERE Id = ?', [userId]);
        if (rows.length === 0) {
            req.flash('error', '사용자 정보를 찾을 수 없습니다.');
            return res.redirect('/profile');
        }

        const lastChangeTime = rows[0].last_nickname_change;
        const now = new Date();

        // 3. 쿨타임(7일) 확인
        if (lastChangeTime) {
            const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000;
            const timeSinceLastChange = now.getTime() - new Date(lastChangeTime).getTime();

            if (timeSinceLastChange < sevenDaysInMillis) {
                const remainingTime = sevenDaysInMillis - timeSinceLastChange;
                const remainingDays = Math.ceil(remainingTime / (1000 * 60 * 60 * 24));
                req.flash('error', `닉네임은 7일에 한 번만 변경할 수 있습니다. (약 ${remainingDays}일 남음)`);
                return res.redirect('/profile');
            }
        }

        // 4. 새 닉네임 생성 (중복 체크 포함)
        let newNickname = '';
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            newNickname = generateRandomNickname();
            const [existing] = await db.query('SELECT 1 FROM userdata WHERE anonymous_nickname = ?', [newNickname]);
            if (existing.length === 0) isUnique = true;
            attempts++;
        }

        if (!isUnique) {
            req.flash('error', '닉네임 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
            return res.redirect('/profile');
        }

        // 5. DB 업데이트 (닉네임 + 변경 시간)
        await db.query(
            'UPDATE userdata SET anonymous_nickname = ?, last_nickname_change = ? WHERE Id = ?',
            [newNickname, now, userId]
        );

        // 6. 세션 갱신
        req.session.user.anonymousNickname = newNickname;

        req.flash('success', `닉네임이 '${newNickname}'(으)로 변경되었습니다.`);
        res.redirect('/profile');

    } catch (e) {
        console.error("닉네임 리롤 오류:", e);
        req.flash('error', '닉네임 변경 중 오류가 발생했습니다.');
        res.redirect('/profile');
    }
});


/**
 * @swagger
 * /profile/edit:
 *   get:
 *     summary: 회원정보 수정 페이지
 *     tags: [Profile]
 *     responses:
 *       200:
 *         description: 회원정보 수정 페이지 렌더링 성공
 *       401:
 *         description: 로그인 필요
 */
router.get('/profile/edit', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/profile/edit');
    }
    res.render('profile-edit', { title: "회원정보 수정" });
});

/**
 * @swagger
 * /profile/update:
 *   put:
 *     summary: 회원정보 수정
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               university:
 *                 type: string
 *               studentNum:
 *                 type: string
 *     responses:
 *       302:
 *         description: 수정 완료 후 프로필 페이지로 리다이렉트
 *       401:
 *         description: 로그인 필요
 */
router.put('/profile/update', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다. 다시 로그인해주세요.');
            return res.redirect('/auth/login');
        }

        const { name, email, university, studentNum } = req.body;
        const userId = req.session.user.id;

        await db.query(
            'UPDATE userdata SET name = ?, email = ?, university = ?, studentNum = ? WHERE Id = ?',
            [name, email, university, studentNum, userId]
        );

        req.session.user.name = name;
        req.session.user.email = email;
        req.session.user.university = university;
        req.session.user.studentNum = studentNum;

        req.flash('success', '회원정보가 성공적으로 수정되었습니다.');
        res.redirect('/profile');

    } catch (e) {
        console.error(e);
        req.flash('error', '정보 수정 중 오류가 발생했습니다.');
        res.redirect('/profile/edit');
    }
});

router.get('/profile/avatar/upload', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/profile/avatar/upload');
    }
    res.render('profile-avatar-upload', {
        title: "프로필 사진 변경"
    });
});

/**
 * @swagger
 * /profile/delete:
 *   delete:
 *     summary: 회원 탈퇴
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *                 description: 본인 확인용 비밀번호
 *     responses:
 *       302:
 *         description: 탈퇴 완료 후 메인 페이지로 리다이렉트
 *       401:
 *         description: 로그인 필요 또는 비밀번호 불일치
 */
router.delete('/profile/delete', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다. 다시 로그인해주세요.');
            return res.redirect('/auth/login');
        }
        const userId = req.session.user.id;
        const { password } = req.body;
        if (!password) {
            req.flash('error', '회원 탈퇴를 위해 비밀번호를 입력해야 합니다.');
            return res.redirect('/profile');
        }

        const [rows] = await db.query('SELECT password_hash FROM userdata WHERE Id = ?', [userId]);
        if (rows.length === 0) {
            req.flash('error', '회원 정보를 찾을 수 없습니다.');
            return res.redirect('/profile');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            req.flash('error', '비밀번호가 일치하지 않습니다.');
            return res.redirect('/profile');
        }

        await db.query('DELETE FROM userdata WHERE Id = ?', [userId]);
        req.flash('success', '회원 탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.');

        req.session.destroy((err) => {
            if (err) console.error(err);
            res.clearCookie('connect.sid');
            res.redirect('/');
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '회원 탈퇴 중 오류가 발생했습니다.');
        res.redirect('/profile');
    }
});

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: 회원가입
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - password
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               id:
 *                 type: string
 *               password:
 *                 type: string
 *               passwordChk:
 *                 type: string
 *               email:
 *                 type: string
 *               university:
 *                 type: string
 *               studentNum:
 *                 type: string
 *     responses:
 *       201:
 *         description: 회원가입 성공
 *       400:
 *         description: 입력값 오류
 *       409:
 *         description: 중복된 아이디
 */
router.post('/auth/signup', async (req, res) => {
    try {
        const { name, id, password, passwordChk, email, university, studentNum } = req.body;
        const fieldErrors = {};
        if (!name) fieldErrors.name = '이름을 입력해 주세요.';
        if (!id) fieldErrors.id = '아이디를 입력해 주세요.';
        if (!email) fieldErrors.email = '이메일을 입력해 주세요.';
        if (!password) fieldErrors.password = '비밀번호를 입력해 주세요.';
        if (password !== passwordChk) fieldErrors.passwordChk = '비밀번호가 일치하지 않습니다.';

        if (Object.keys(fieldErrors).length) {
            if (wantsJSON(req)) return res.status(400).json({ ok:false, message:'입력값 오류', fieldErrors });
            req.flash('error', '입력값을 확인해 주세요.');
            return res.redirect('/auth/signup');
        }

        const [dup] = await db.query('SELECT 1 FROM userdata WHERE Id=?', [id]);
        if (dup.length) {
            const msg = '이미 사용 중인 아이디입니다.';
            if (wantsJSON(req)) return res.status(409).json({ ok:false, message: msg });
            req.flash('error', msg);
            return res.redirect('/auth/signup');
        }

        const hash = await bcrypt.hash(password, 12);
        const anonymousNickname = generateRandomNickname();
        await db.query(
            'INSERT INTO userdata (name, Id, password_hash, email, university, studentNum, anonymous_nickname) VALUES (?,?,?,?,?,?,?)',
            [name, id, hash, email, university, studentNum, anonymousNickname]
        );

        const okResp = { ok:true, message:'회원가입이 완료되었습니다.', redirect:'/auth/login' };
        if (wantsJSON(req)) return res.status(201).json(okResp);
        req.flash('success', okResp.message);
        return res.redirect('/auth/login');

    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'서버 오류' });
        req.flash('error', '서버 오류가 발생했습니다.');
        return res.redirect('/auth/signup');
    }
});

/**
 * @swagger
 * /rankings:
 *   get:
 *     summary: 명예의 전당 (Top 10) 조회
 *     description: |
 *       `userdata` 테이블에서 평판 점수(`reputation_score`) 기준으로 상위 10명의 익명 닉네임과 점수를 조회합니다.
 *       서버는 해당 데이터를 `rankings.ejs` 뷰로 렌더링하여 클라이언트에 HTML을 반환합니다.
 *     tags:
 *       - Ranking
 *     responses:
 *       200:
 *         description: 랭킹 조회 성공
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "<!DOCTYPE html><html><body>명예의 전당 (Top 10) 페이지</body></html>"
 *       500:
 *         description: 서버 내부 오류 (랭킹 조회 실패)
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
 *                   example: "랭킹을 불러오는 중 오류가 발생했습니다."
 */
router.get('/rankings', async (req, res) => {
    try {
        // 1. MariaDB에서 평판 점수 기준 상위 10명 조회
        const [topUsers] = await db.query(
            'SELECT anonymous_nickname, reputation_score FROM userdata ORDER BY reputation_score DESC LIMIT 10'
        );

        // 2. 뷰 렌더링
        res.render('rankings', {
            title: "명예의 전당 (Top 10)",
            topUsers: topUsers
        });

    } catch (e) {
        console.error("랭킹 로드 오류:", e);
        req.flash('error', '랭킹을 불러오는 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});


/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: 로그인
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 로그인 성공
 *       401:
 *         description: 로그인 실패 (아이디 또는 비밀번호 오류)
 */
router.post('/auth/login', async (req, res) => {
    try {
        const { id, password, redirect } = req.body;
        const [rows] = await db.query('SELECT * FROM userdata WHERE Id=?', [id]);
        const failMsg = '아이디 또는 비밀번호가 올바르지 않습니다.';

        if (!rows.length) {
            if (wantsJSON(req)) return res.status(401).json({ ok:false, message: failMsg });
            req.flash('error', failMsg); return res.redirect('/auth/login');
        }
        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        const redirectUrl = (redirect && redirect.startsWith('/')) ? redirect : '/profile';
        if (!ok) {
            if (wantsJSON(req)) return res.status(401).json({ ok:false, message: failMsg });
            req.flash('error', failMsg); return res.redirect('/auth/login');
        }

        let userNickname = user.anonymous_nickname;
        if (!userNickname) {
            userNickname = generateRandomNickname();
            await db.query('UPDATE userdata SET anonymous_nickname = ? WHERE Id = ?', [userNickname, user.Id]);
        }

        req.session.user = {
            id: user.Id, name: user.name, email: user.email, university:user.university,
            studentNum: user.studentNum, anonymousNickname: userNickname,
            reputationScore: user.reputation_score, isAdmin: user.is_admin
        };

        const okResp = { ok:true, message:`환영합니다, ${user.name}님!`, redirect: redirectUrl };
        if (wantsJSON(req)) return res.json(okResp);
        req.flash('success', okResp.message);
        return res.redirect(redirectUrl);
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'서버 오류' });
        req.flash('error', '서버 오류가 발생했습니다.');
        return res.redirect('/auth/login');
    }
});

/**
 * @swagger
 * /profile/avatar/upload:
 *   get:
 *     summary: 프로필 사진 업로드 페이지 조회
 *     description: 로그인된 사용자가 자신의 프로필 사진 변경 페이지(`profile-avatar-upload.ejs`)를 조회합니다.
 *     tags:
 *       - User
 *     responses:
 *       200:
 *         description: 프로필 사진 업로드 페이지 렌더링 성공
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "<!DOCTYPE html><html><body>프로필 사진 업로드 페이지</body></html>"
 *       302:
 *         description: 로그인되지 않은 경우 로그인 페이지로 리다이렉트
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: "/auth/login?redirect=/profile/avatar/upload"
 */
router.get('/profile/avatar/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const safeFilename = path.basename(filename);
        const filePath = path.join(__dirname, '..', 'uploads', 'profile_images', safeFilename);

        res.sendFile(filePath, (err) => {
            if (err) {
                console.error("프로필 이미지 전송 실패:", err.code, '-', err.message);
                res.status(404).send('Image Not Found');
            }
        });
    } catch (e) {
        console.error("프로필 이미지 라우트 내부 오류:", e);
        res.status(500).send('Server Error');
    }
});


/**
 * @swagger
 * /profile/avatar/upload:
 *   put:
 *     summary: 프로필 사진 업로드
 *     description: |
 *       로그인한 사용자가 자신의 프로필 사진을 업로드하여 DB(`userdata.profile_image_path`)와 세션 정보를 갱신합니다.
 *       Multer 미들웨어를 통해 파일 크기 제한(기본 5MB) 및 이미지 형식(JPEG, PNG 등) 검증이 수행됩니다.
 *     tags:
 *       - User
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               profileImage:
 *                 type: string
 *                 format: binary
 *                 description: 업로드할 프로필 이미지 파일
 *     responses:
 *       200:
 *         description: 업로드 성공 (리다이렉트)
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "/profile 페이지로 리다이렉트됨"
 *       400:
 *         description: 잘못된 요청 (파일 누락 또는 형식 오류)
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
 *                   example: "이미지 파일을 선택해주세요."
 *       401:
 *         description: 인증 실패 (세션 만료)
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
 *                   example: "세션이 만료되었습니다. 다시 로그인해주세요."
 *       413:
 *         description: 파일 크기 초과 (Multer 제한 초과)
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
 *                   example: "파일 업로드 오류: File too large (최대 5MB)"
 *       500:
 *         description: 서버 내부 오류
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
 *                   example: "사진 변경 중 오류가 발생했습니다."
 */

router.put('/profile/avatar/upload', uploadProfileImage.single('profileImage'), async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다. 다시 로그인해주세요.');
            return res.redirect('/auth/login');
        }

        if (req.fileValidationError) {
            req.flash('error', req.fileValidationError);
            return res.redirect('/profile/avatar/upload');
        }

        if (!req.file) {
            req.flash('error', '이미지 파일을 선택해주세요.');
            return res.redirect('/profile/avatar/upload');
        }

        const imagePath = req.file.path.replace(/\\/g, '/').replace('public', '');

        const userId = req.session.user.id;
        await db.query(
            'UPDATE userdata SET profile_image_path = ? WHERE Id = ?',
            [imagePath, userId]
        );

        req.session.user.profileImagePath = imagePath;

        req.flash('success', '프로필 사진이 성공적으로 변경되었습니다.');
        res.redirect('/profile');

    } catch (e) {
        console.error("프로필 이미지 업로드 오류:", e);
        if (e instanceof multer.MulterError) {
            req.flash('error', `파일 업로드 오류: ${e.message} (최대 5MB)`);
        } else {
            req.flash('error', '사진 변경 중 오류가 발생했습니다.');
        }
        res.redirect('/profile/avatar/upload');
    }
});

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: 알림 목록 조회
 *     description: |
 *       로그인한 사용자의 모든 알림(Notification 컬렉션)을 최신순으로 조회합니다.
 *       로그인되지 않은 경우 로그인 페이지로 리다이렉트됩니다.
 *     tags:
 *       - Notification
 *     responses:
 *       200:
 *         description: 알림 목록 조회 성공
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "<!DOCTYPE html><html><body>알림 목록 페이지</body></html>"
 *       302:
 *         description: 로그인되지 않은 경우 로그인 페이지로 리다이렉트
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: "/auth/login?redirect=/notifications"
 *       500:
 *         description: 서버 내부 오류 (알림 로드 실패)
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
 *                   example: "알림을 불러오는 중 오류가 발생했습니다."
 */
router.get('/notifications', async (req, res) => {
    try {
        // 1. 로그인 확인
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login?redirect=/notifications');
        }

        const userId = req.session.user.id;

        // 2. 유저의 알림 조회 (최신순)
        const notifications = await Notification.find({ userId: userId })
            .sort({ createdAt: -1 });

        // 3. 뷰 렌더링
        res.render('notifications', {
            title: "알림 목록",
            notifications: notifications
        });

    } catch (e) {
        console.error("알림 목록 로드 오류:", e);
        req.flash('error', '알림을 불러오는 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});


/**
 * @swagger
 * /notifications/read/{id}:
 *   put:
 *     summary: 특정 알림 읽음 처리
 *     description: |
 *       로그인한 사용자가 자신의 특정 알림을 읽음(`isRead: true`) 상태로 변경합니다.
 *       알림 ID와 세션의 사용자 ID가 일치해야만 처리됩니다.
 *     tags:
 *       - Notification
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 읽음 처리할 알림의 ObjectId
 *         example: "652d5a28e4b2f7f3a1234567"
 *     responses:
 *       200:
 *         description: 읽음 처리 성공 (리다이렉트)
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: "/notifications 페이지로 리다이렉트됨"
 *       401:
 *         description: 인증 실패 (세션 만료)
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
 *                   example: "세션이 만료되었습니다. 다시 로그인해주세요."
 *       403:
 *         description: 권한 없음 (다른 사용자 알림 접근 시)
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
 *                   example: "알림을 찾을 수 없거나 처리할 권한이 없습니다."
 *       404:
 *         description: 알림을 찾을 수 없음
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
 *                   example: "알림이 존재하지 않습니다."
 *       500:
 *         description: 서버 내부 오류 (읽음 처리 실패)
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
 *                   example: "알림 처리 중 오류가 발생했습니다."
 */
router.put('/notifications/read/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { id: notificationId } = req.params;
        const userId = req.session.user.id;

        const updatedNotification = await Notification.findOneAndUpdate(
            { _id: notificationId, userId: userId },
            { isRead: true },
            { new: true }
        );

        if (!updatedNotification) {
            req.flash('error', '알림을 찾을 수 없거나 처리할 권한이 없습니다.');
        }

        res.redirect('/notifications');

    } catch (e) {
        console.error("알림 읽음 처리 오류:", e);
        req.flash('error', '알림 처리 중 오류가 발생했습니다.');
        res.redirect('/notifications');
    }
});

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     summary: 특정 알림 삭제
 *     description: 로그인한 사용자가 자신의 특정 알림을 삭제합니다.
 *     tags:
 *       - Notification
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 삭제할 알림의 ObjectId
 *         example: "652d5a28e4b2f7f3a1234567"
 *     responses:
 *       200:
 *         description: 삭제 성공 (리다이렉트)
 *       401:
 *         description: 인증 실패 (세션 만료)
 *       403:
 *         description: 권한 없음 (내 알림이 아님)
 *       404:
 *         description: 해당 알림을 찾을 수 없음
 *       500:
 *         description: 서버 내부 오류
 */
router.delete('/notifications/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }
        const { id } = req.params;
        const userId = req.session.user.id;

        const deleted = await Notification.findOneAndDelete({ _id: id, userId });
        if (!deleted) {
            req.flash('error', '알림을 찾을 수 없거나 삭제 권한이 없습니다.');
        } else {
            req.flash('success', '알림을 삭제했습니다.');
        }
        res.redirect('/notifications');
    } catch (e) {
        console.error('알림 삭제 오류:', e);
        req.flash('error', '알림 삭제 중 오류가 발생했습니다.');
        res.redirect('/notifications');
    }
});

/**
 * @swagger
 * /notifications/read-all:
 *   put:
 *     summary: 모든 알림 읽음 처리
 *     description: |
 *       로그인한 사용자의 모든 미읽음 알림을 읽음 상태로 변경합니다.
 *       내부 처리: isRead: true 로 업데이트합니다.
 *     tags:
 *       - Notification
 *     responses:
 *       200:
 *         description: 전체 읽음 처리 성공 (리다이렉트)
 *       401:
 *         description: 인증 실패 (세션 만료)
 *       500:
 *         description: 서버 내부 오류
 */
router.put('/notifications/read-all', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }
        const userId = req.session.user.id;
        await Notification.updateMany({ userId, isRead: { $ne: true } }, { $set: { isRead: true } });
        res.redirect('/notifications');
    } catch (e) {
        console.error('전체 읽음 처리 오류:', e);
        req.flash('error', '전체 읽음 처리 중 오류가 발생했습니다.');
        res.redirect('/notifications');
    }
});






module.exports = router;
