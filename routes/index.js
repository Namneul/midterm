const express  = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../models/maria');
const AuctionItem = require('../models/AuctionItem')
const BoardPost = require('../models/BoardPost');
const Comment = require('../models/Comment')

function wantsJSON(req) {
    return req.xhr || req.get('accept')?.includes('application/json');
}

function generateRandomNickname(){
    const adjectives = ["친절한", "용감한", "배고픈", "졸린", "행복한", "재빠른", "빛나는"];
    const nouns = ["코알라", "다람쥐", "호랑이", "고양이", "개발자", "학생", "유니콘"];
    // 겹치지 않도록 뒤에 0~999 사이 랜덤 숫자를 붙입니다.
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${randomAdj} ${randomNoun}${Math.floor(Math.random() * 1000)}`;
}

router.get('/', async (req, res) => { // 'async' 확인
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20; // ⭐️ 20개
        const skip = (page - 1) * limit;

        const items = await AuctionItem.find({ status: 'active' })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalItems = await AuctionItem.countDocuments({ status: 'active' });
        const totalPages = Math.ceil(totalItems / limit);

        // [핵심] 1. 'currentPage'와 'totalPages'를 *반드시* 전달해야 합니다
        res.render('main', {
            title: "메인",
            items: items,
            currentPage: page,
            totalPages: totalPages
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '경매 목록을 불러오는 데 실패했습니다.');

        // [핵심] 2. 오류가 났을 때도 변수들을 전달해야 합니다
        res.render('main', {
            title: "메인",
            items: [],
            currentPage: 1, // ⭐️ 오류 시 기본값
            totalPages: 1   // ⭐️ 오류 시 기본값
        });
    }
});

router.get('/auth/login', (req, res) => {
    res.render('login-signup', {
        title: '로그인',
        mode: 'login',
        redirect: req.query.redirect
    });
});

router.get('/auth/logout', (req, res) => {

    // 1. 플래시 메시지를 *먼저* 설정합니다. (세션이 아직 살아있을 때)
    req.flash('success', '로그아웃되었습니다.');

    // 2. 그 다음, 세션을 파괴합니다.
    req.session.destroy(err => {
        if (err) {
            console.error(err);
            // 세션 파괴 실패 시, 플래시를 또 쓸 수 없으므로 쿼리스트링 등으로 처리
            return res.redirect('/auth/login?error=logout-failed');
        }

        // 3. 쿠키를 지우고 리다이렉트합니다.
        res.clearCookie('connect.sid');
        return res.redirect('/');
    });
});



router.get('/auth/signup', (req, res) => {
    res.render('login-signup', {
        title: '회원가입',
        mode:'signup'
    });
});

router.get('/profile', async (req, res) => {
    try {
        // [검사] 1. 로그인 안 했으면 튕기기
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login?redirect=/profile');
        }

        const userId = req.session.user.id; // 현재 로그인한 유저의 MariaDB ID

        // [DB 쿼리 1] 내 판매 목록 (최신순)
        const myAuctions = await AuctionItem.find({ sellerId: userId })
            .sort({ createdAt: -1 });

        // [DB 쿼리 2] 내 낙찰 목록 (최신순)
        const myBidsWon = await AuctionItem.find({
            highestBidderId: userId,
            status: 'ended'
        }).sort({ endDate: -1 }); // 마감순

        // [DB 쿼리 3] 내 작성글 목록 (최신순)
        const myPosts = await BoardPost.find({ authorId: userId })
            .sort({ createdAt: -1 });

        // [렌더링] 3. profile.ejs에 모든 데이터 전달
        res.render('profile', { // ⭐️ 2단계: views/profile.ejs (신규)
            title: "마이페이지",
            myAuctions: myAuctions,
            myBidsWon: myBidsWon,
            myPosts: myPosts
            // currentUser는 layout.ejs에서 이미 전역으로 사용 가능
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '프로필을 불러오는 중 오류가 발생했습니다.');
        res.redirect('/');
    }
});

router.get('/profile/edit', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/profile/edit');
    }
    // ⭐️ 2단계: 'views/profile-edit.ejs'를 렌더링
    res.render('profile-edit', {
        title: "회원정보 수정"
        // (currentUser는 전역 변수라 EJS에서 바로 사용 가능)
    });
});

router.put('/profile/update', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다. 다시 로그인해주세요.');
            return res.redirect('/auth/login');
        }

        // 1. 폼에서 수정할 정보 받기 (ID, 닉네임 등은 수정 불가)
        const { name, email, university, studentNum } = req.body;
        const userId = req.session.user.id;

        // 2. MariaDB 업데이트
        await db.query(
            'UPDATE userdata SET name = ?, email = ?, university = ?, studentNum = ? WHERE Id = ?',
            [name, email, university, studentNum, userId]
        );

        // 3. [중요] 세션 정보도 함께 갱신
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

router.delete('/profile/delete', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다. 다시 로그인해주세요.');
            return res.redirect('/auth/login');
        }

        const userId = req.session.user.id;
        const { password } = req.body; // ⭐️ [추가] 1. 폼에서 비밀번호 받기

        // [추가] 2. 비밀번호 입력 여부 확인
        if (!password) {
            req.flash('error', '회원 탈퇴를 위해 비밀번호를 입력해야 합니다.');
            return res.redirect('/profile');
        }

        // [추가] 3. DB에서 현재 유저의 '진짜' 비밀번호 해시 가져오기
        const [rows] = await db.query('SELECT password_hash FROM userdata WHERE Id = ?', [userId]);
        if (rows.length === 0) {
            req.flash('error', '회원 정보를 찾을 수 없습니다.');
            return res.redirect('/profile');
        }

        // [추가] 4. 비밀번호 검증
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            req.flash('error', '비밀번호가 일치하지 않습니다.');
            return res.redirect('/profile');
        }

        // --- (비밀번호 검증 통과) ---
        // (기존 탈퇴 로직 시작)
        const anonymizeNickname = '탈퇴한 회원';

        // ... (MongoDB 경매/게시글/댓글 익명화 4종 세트)
        await AuctionItem.updateMany({ sellerId: userId }, { /* ... */ });
        await AuctionItem.updateMany({ highestBidderId: userId }, { /* ... */ });
        await BoardPost.updateMany({ authorId: userId }, { /* ... */ });
        await Comment.updateMany({ authorId: userId }, { /* ... */ });

        // ... (MariaDB 유저 본인 정보 삭제)
        await db.query('DELETE FROM userdata WHERE Id = ?', [userId]);


        // [수정] 5. (오류 해결)
        // ⭐️ 세션을 파괴하기 '전'에 플래시 메시지를 먼저 설정합니다.
        req.flash('success', '회원 탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.');

        // [수정] 6. 세션 파괴 (콜백 안에서 res.redirect)
        req.session.destroy((err) => {
            if (err) {
                console.error(err);
                // 플래시가 이미 설정됐으니, 오류가 나도 그냥 홈으로 보냅니다.
                return res.redirect('/');
            }
            res.clearCookie('connect.sid');
            res.redirect('/'); // ⭐️ 성공 리다이렉트는 콜백 '안'에서!
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '회원 탈퇴 중 심각한 오류가 발생했습니다. 관리자에게 문의하세요.');
        res.redirect('/profile');
    }
});


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
            if (wantsJSON(req)) return res.status(409).json({ ok:false, message: msg, fieldErrors:{ id: msg } });
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

router.post('/auth/login', async (req, res) => {
    try {
        const { id, password, redirect } = req.body;
        const [rows] = await db.query('SELECT * FROM userdata WHERE Id=?', [id]);
        const failMsg = '아이디 또는 비밀번호가 올바르지 않습니다.';

        if (!rows.length) {
            if (wantsJSON(req)) return res.status(401).json({ ok:false, message: failMsg, fieldErrors:{ id: failMsg }});
            req.flash('error', failMsg); return res.redirect('/auth/login');
        }
        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        const redirectUrl = (redirect && redirect.startsWith('/')) ? redirect : '/profile';
        if (!ok) {
            if (wantsJSON(req)) return res.status(401).json({ ok:false, message: failMsg, fieldErrors:{ password: failMsg }});
            req.flash('error', failMsg); return res.redirect('/auth/login');
        }

        let userNickname = user.anonymous_nickname;
        if (!userNickname) { // 닉네임이 NULL(비어있으면)
            console.log(`[로그인] 기존 유저 (${user.Id}) 닉네임 없음. 새로 생성 후 DB 업데이트...`);
            userNickname = generateRandomNickname(); // (a) 새 닉네임 생성
            // (b) DB에 이 닉네임을 즉시 저장
            await db.query('UPDATE userdata SET anonymous_nickname = ? WHERE Id = ?', [userNickname, user.Id]);
        }

        req.session.user = { id: user.Id, name: user.name, email: user.email, university:user.university,
            studentNum: user.studentNum, anonymousNickname: userNickname, reputationScore: user.reputation_score,isAdmin: user.is_admin };
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


module.exports = router;