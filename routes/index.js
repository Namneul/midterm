const express  = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../models/maria');

function wantsJSON(req) {
    return req.xhr || req.get('accept')?.includes('application/json');
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

router.get('/auth/signup', (req, res) => {
    res.render('login-signup', {
        title: '회원가입',
        mode:'signup'
    });
});

router.get('/profile', (req, res) => {
    res.render('profile', {
        title:"프로필"
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
        await db.query(
            'INSERT INTO userdata (name, Id, password_hash, email, university, studentNum) VALUES (?,?,?,?,?,?)',
            [name, id, hash, email, university, studentNum]
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

        req.session.user = { id: user.Id, name: user.name };
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