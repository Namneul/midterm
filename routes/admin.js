const express = require('express');
const router = express.Router();
const db = require('../models/maria'); // MariaDB 연결

// JSON 선호 감지: Swagger "Try it out" 요청 대응
function wantsJSON(req) {
    return req.xhr || req.get('accept')?.includes('application/json');
}

// 관리자 권한 미들웨어
function isAdmin(req, res, next) {
    const user = req.session?.user;
    if (!user) {
        if (wantsJSON(req)) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/admin');
    }
    if (user.isAdmin !== 1) {
        if (wantsJSON(req)) return res.status(403).json({ ok: false, message: '관리자 권한이 없습니다.' });
        req.flash('error', '관리자만 접근 가능합니다.');
        return res.redirect('/');
    }
    next();
}

/**
 * @swagger
 * tags:
 *   - name: Admin
 *     description: 관리자 기능 API
 *
 * components:
 *   schemas:
 *     AdminUserSearchResult:
 *       type: object
 *       properties:
 *         Id:
 *           type: string
 *           example: "appuser01"
 *         name:
 *           type: string
 *           example: "홍길동"
 *         email:
 *           type: string
 *           example: "user@example.com"
 *         university:
 *           type: string
 *           example: "전북대학교"
 *         anonymous_nickname:
 *           type: string
 *           example: "용감한 코알라123"
 */

// ---------------------------------
// GET /admin (관리자 메인 페이지)
// ---------------------------------

/**
 * @swagger
 * /admin:
 *   get:
 *     summary: 관리자 메인 페이지
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: 관리자 페이지 렌더링(HTML) 또는 상태(JSON)
 *       401:
 *         description: 로그인 필요
 *       403:
 *         description: 관리자 권한 없음
 */
router.get('/', isAdmin, (req, res) => {
    // HTML 렌더가 기본, Swagger 등 JSON 선호 시 상태 JSON 제공
    if (wantsJSON(req)) {
        return res.json({ ok: true, message: '관리자 페이지', searchResult: null });
    }
    res.render('admin', {
        title: '관리자 페이지',
        searchResult: null, // 초기값
    });
});

// ---------------------------------
// POST /admin/search (사용자 검색)
// ---------------------------------

/**
 * @swagger
 * /admin/search:
 *   post:
 *     summary: 익명 닉네임으로 사용자 검색
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [anonymousNickname]
 *             properties:
 *               anonymousNickname:
 *                 type: string
 *                 example: "용감한 코알라123"
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [anonymousNickname]
 *             properties:
 *               anonymousNickname:
 *                 type: string
 *                 example: "용감한 코알라123"
 *     responses:
 *       200:
 *         description: 검색 성공(HTML 렌더 또는 JSON 반환)
 *       400:
 *         description: 잘못된 요청(닉네임 미입력)
 *       401:
 *         description: 로그인 필요
 *       403:
 *         description: 관리자 권한 없음
 *       500:
 *         description: 서버 오류
 */
router.post('/search', isAdmin, async (req, res) => {
    try {
        const { anonymousNickname } = req.body;

        if (!anonymousNickname) {
            if (wantsJSON(req)) {
                return res.status(400).json({ ok: false, message: '검색할 익명 닉네임을 입력하세요.' });
            }
            req.flash('error', '검색할 익명 닉네임을 입력하세요.');
            return res.redirect('/admin');
        }

        // 1) 익명 닉네임으로 'userdata' 테이블 검색
        const [rows] = await db.query(
            'SELECT Id, name, email, university, anonymous_nickname FROM userdata WHERE anonymous_nickname = ?',
            [anonymousNickname]
        );

        let result = null;
        if (rows.length > 0) {
            result = rows[0]; // (Id, name, email, university, anonymous_nickname)
        } else {
            if (wantsJSON(req)) {
                // JSON 요청이면 404로 명확히 통지
                return res.status(404).json({ ok: false, message: '해당 닉네임의 사용자를 찾을 수 없습니다.' });
            }
            req.flash('error', '해당 닉네임의 사용자를 찾을 수 없습니다.');
        }

        // 2) JSON 선호면 JSON으로, 아니면 admin.ejs 렌더
        if (wantsJSON(req)) {
            return res.json({
                ok: true,
                result, // null 또는 AdminUserSearchResult
            });
        }

        return res.render('admin', {
            title: '관리자 페이지',
            searchResult: result,
        });
    } catch (e) {
        console.error(e);
        if (wantsJSON(req)) {
            return res.status(500).json({ ok: false, message: '검색 중 서버 오류가 발생했습니다.' });
        }
        req.flash('error', '검색 중 서버 오류가 발생했습니다.');
        return res.redirect('/admin');
    }
});

module.exports = router;
