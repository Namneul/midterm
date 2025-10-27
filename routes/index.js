const express  = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../models/maria');

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

router.get('/', (req, res) => {
    res.render('main', {
        title:"메인"
    });
});

router.get('/auth/login', (req, res) => {
    res.render('login-signup', {
        title: '로그인',
        mode: 'login'
    });
});

// routes/index.js (수정된 코드)

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

router.get('/profile', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.')
        return res.redirect('/auth/login');
    }
    res.render('profile', {
        title:"프로필",
        user: req.session.user,
    });
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
        const { id, password } = req.body;
        const [rows] = await db.query('SELECT * FROM userdata WHERE Id=?', [id]);
        const failMsg = '아이디 또는 비밀번호가 올바르지 않습니다.';

        if (!rows.length) {
            if (wantsJSON(req)) return res.status(401).json({ ok:false, message: failMsg, fieldErrors:{ id: failMsg }});
            req.flash('error', failMsg); return res.redirect('/auth/login');
        }
        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            if (wantsJSON(req)) return res.status(401).json({ ok:false, message: failMsg, fieldErrors:{ password: failMsg }});
            req.flash('error', failMsg); return res.redirect('/auth/login');
        }

        req.session.user = { id: user.Id, name: user.name,
            email: user.email, university:user.university, studentNum: user.studentNum, anonymousNickname: user.anonymous_nickname };
        const okResp = { ok:true, message:`환영합니다, ${user.name}님!`, redirect:'/profile' };
        if (wantsJSON(req)) return res.json(okResp);
        req.flash('success', okResp.message); return res.redirect('/profile');

    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) return res.status(500).json({ ok:false, message:'서버 오류' });
        req.flash('error', '서버 오류가 발생했습니다.');
        return res.redirect('/auth/login');
    }
});


module.exports = router;