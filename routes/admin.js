const express = require('express');
const router = express.Router();
const db = require('../models/maria'); // MariaDB 연결

// ---------------------------------
// GET /admin (관리자 메인 페이지)
// ---------------------------------
// ⭐️ 'isAdmin' 미들웨어(검문소)를 라우트 핸들러 앞에 추가
router.get('/', (req, res) => {
    // (검색 결과가 있을 경우를 대비해 query에서 받음)
    res.render('admin', {
        title: "관리자 페이지",
        searchResult: null // 초기값은 null
    });
});

// ---------------------------------
// POST /admin/search (사용자 검색)
// ---------------------------------
router.post('/search', async (req, res) => {
    try {
        const { anonymousNickname } = req.body;
        if (!anonymousNickname) {
            req.flash('error', '검색할 익명 닉네임을 입력하세요.');
            return res.redirect('/admin');
        }

        // [핵심] 1. 익명 닉네임으로 'userdata' 테이블 검색
        const [rows] = await db.query(
            'SELECT Id, name, email, university, anonymous_nickname FROM userdata WHERE anonymous_nickname = ?',
            [anonymousNickname]
        );

        let result = null;
        if (rows.length > 0) {
            result = rows[0]; // (Id, name, email, university, anonymous_nickname)
        } else {
            req.flash('error', '해당 닉네임의 사용자를 찾을 수 없습니다.');
        }

        // [핵심] 2. 'admin.ejs'를 다시 렌더링하면서 '검색 결과(result)' 전달
        res.render('admin', {
            title: "관리자 페이지",
            searchResult: result // ⭐️ 검색 결과 전달
        });

    } catch (e) {
        console.error(e);
        req.flash('error', '검색 중 서버 오류가 발생했습니다.');
        res.redirect('/admin');
    }
});

module.exports = router;