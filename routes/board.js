const express = require('express');
const router = express.Router();
const BoardPost = require('../models/BoardPost');
const Comment = require('../models/Comment');
const Notification = require('../models/Notifications');

function wantsJSON(req) {
    return req.xhr || req.get('accept')?.includes('application/json');
}

/**
 * @swagger
 * tags:
 *   - name: Board
 *     description: 자유게시판 글 API
 *   - name: Comment
 *     description: 게시글 댓글 API
 *
 * components:
 *   schemas:
 *     BoardPost:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6763f1a9c4f1b2f0b0c12345"
 *         title:
 *           type: string
 *           example: "첫 글입니다"
 *         content:
 *           type: string
 *           example: "안녕하세요! 자유게시판 테스트 글입니다."
 *         authorId:
 *           type: string
 *           example: "appuser01"
 *         authorNickname:
 *           type: string
 *           example: "용감한 코알라123"
 *         authorReputation:
 *           type: integer
 *           example: 12
 *         comments:
 *           type: array
 *           items:
 *             type: string
 *           example: ["6763f1a9c4f1b2f0b0caa111","6763f1a9c4f1b2f0b0caa222"]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     Comment:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6763f1a9c4f1b2f0b0caa111"
 *         post:
 *           type: string
 *           example: "6763f1a9c4f1b2f0b0c12345"
 *         content:
 *           type: string
 *           example: "댓글 내용입니다."
 *         authorId:
 *           type: string
 *           example: "appuser01"
 *         authorNickname:
 *           type: string
 *           example: "용감한 코알라123"
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

// -----------------------------
// 1. 게시글 (Post)
// -----------------------------

/**
 * @swagger
 * /board:
 *   get:
 *     summary: 게시글 목록 (페이지네이션)
 *     description: 최신순으로 게시글을 페이지네이션하여 렌더링합니다.
 *     tags: [Board]
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호 (기본 1)
 *     responses:
 *       200:
 *         description: 목록 페이지 렌더링 성공
 *       302:
 *         description: 오류 시 리다이렉트
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20; // 한 페이지에 20개
        const skip = (page - 1) * limit;

        const posts = await BoardPost.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalPosts = await BoardPost.countDocuments();
        const totalPages = Math.ceil(totalPosts / limit);

        res.render('board', {
            title: "자유게시판",
            posts: posts,
            currentPage: page,
            totalPages: totalPages
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '게시판을 불러오는 데 실패했습니다.');
        res.redirect('/');
    }
});

/**
 * @swagger
 * /board/{id}/like:
 *   post:
 *     summary: 게시글 좋아요 / 좋아요 취소
 *     description: |
 *       로그인한 사용자가 특정 게시글에 대해 '좋아요'를 누르거나 취소합니다.
 *       같은 사용자가 다시 호출하면 토글되어 취소됩니다.
 *       요청이 JSON을 원하면 JSON을, 그 외에는 HTML 리다이렉트를 반환합니다.
 *     tags:
 *       - Board
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 좋아요 대상 게시글의 ObjectId
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
 *                   description: "liked=좋아요 추가, unliked=좋아요 취소"
 *                   example: "liked"
 *                 likeCount:
 *                   type: integer
 *                   example: 14
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
router.post('/:id/like', async (req, res) => {
    try {
        // 1. 로그인 확인
        if (!req.session.user) {
            req.flash('error', '좋아요를 누르려면 로그인이 필요합니다.');
            if (wantsJSON(req)) return res.status(401).json({ ok: false, message: '로그인 필요' });
            return res.redirect('/auth/login');
        }

        const postId = req.params.id;
        const userId = req.session.user.id;

        // 2. 게시글 찾기
        const post = await BoardPost.findById(postId);
        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            if (wantsJSON(req)) return res.status(404).json({ ok: false, message: '게시글 없음' });
            return res.redirect('/board');
        }

        // 3. 이미 좋아요를 눌렀는지 확인
        const likedIndex = post.likes.indexOf(userId);

        if (likedIndex > -1) {
            // 좋아요 취소
            post.likes.pull(userId);
            if (wantsJSON(req)) req.session.likeAction = 'unliked';
        } else {
            // 좋아요 추가
            post.likes.push(userId);
            if (wantsJSON(req)) req.session.likeAction = 'liked';
        }

        // 4. 변경사항 저장
        await post.save();

        // 5. JSON 요청 시 응답
        if (wantsJSON(req)) {
            return res.json({
                ok: true,
                action: req.session.likeAction,
                likeCount: post.likes.length
            });
        }

        // 6. HTML 요청 시 리다이렉트
        res.redirect(`/board/${postId}`);

    } catch (e) {
        console.error("좋아요 처리 오류:", e);
        if (wantsJSON(req)) return res.status(500).json({ ok: false, message: '서버 오류' });
        req.flash('error', '좋아요 처리 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.id || ''}`);
    }
});


/**
 * @swagger
 * /board/new:
 *   get:
 *     summary: 글쓰기 폼
 *     tags: [Board]
 *     responses:
 *       200:
 *         description: 글쓰기 폼 렌더링 성공
 *       302:
 *         description: 로그인 필요 시 로그인 페이지로 리다이렉트
 */
router.get('/new', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/board/new');
    }
    res.render('board-new', {
        title: "새 글 작성"
    });
});

/**
 * @swagger
 * /board:
 *   post:
 *     summary: 게시글 생성
 *     tags: [Board]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title:
 *                 type: string
 *                 example: "첫 글입니다"
 *               content:
 *                 type: string
 *                 example: "안녕하세요! 자유게시판 테스트 글입니다."
 *     responses:
 *       302:
 *         description: 생성 성공 시 상세 페이지로 리다이렉트 / 실패 시 폼으로 리다이렉트
 */
router.post('/', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { title, content } = req.body;
        const {
            id: authorId,
            anonymousNickname: authorNickname,
            reputationScore: authorReputation
        } = req.session.user;

        if (!title || !content) {
            req.flash('error', '제목과 내용을 모두 입력해주세요.');
            return res.redirect('/board/new');
        }

        const newPost = new BoardPost({
            title,
            content,
            authorId,
            authorNickname,
            authorReputation
        });

        await newPost.save();

        req.flash('success', '글이 성공적으로 등록되었습니다.');
        res.redirect(`/board/${newPost._id}`);
    } catch (e) {
        console.error(e);
        req.flash('error', '글 등록 중 오류가 발생했습니다.');
        res.redirect('/board/new');
    }
});

/**
 * @swagger
 * /board/{id}:
 *   get:
 *     summary: 게시글 상세 (댓글 포함)
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 게시글 ID (Mongo ObjectId)
 *     responses:
 *       200:
 *         description: 상세 페이지 렌더링 성공
 *       302:
 *         description: 글 없거나 오류 시 목록으로 리다이렉트
 */
router.get('/:id', async (req, res) => {
    try {
        const post = await BoardPost.findById(req.params.id)
            .populate('comments');

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        res.render('board-detail', {
            title: post.title,
            post: post
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '게시글을 불러오는 데 실패했습니다.');
        res.redirect('/board');
    }
});

/**
 * @swagger
 * /board/{id}/edit:
 *   get:
 *     summary: 게시글 수정 폼
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 수정 폼 렌더링 성공
 *       302:
 *         description: 권한 없음/미로그인/글 없음 등 리다이렉트
 */
router.get('/:id/edit', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const post = await BoardPost.findById(req.params.id);

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        if (post.authorId !== req.session.user.id) {
            req.flash('error', '수정 권한이 없습니다.');
            return res.redirect(`/board/${req.params.id}`);
        }

        res.render('board-edit', {
            title: "게시글 수정",
            post: post
        });

    } catch (e) {
        console.error(e);
        res.redirect(`/board/${req.params.id}`);
    }
});

/**
 * @swagger
 * /board/{id}:
 *   put:
 *     summary: 게시글 수정
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title:
 *                 type: string
 *                 example: "수정한 제목"
 *               content:
 *                 type: string
 *                 example: "수정한 내용"
 *     responses:
 *       302:
 *         description: 수정 성공 시 상세 페이지 / 실패 시 수정 폼으로 리다이렉트
 */
router.put('/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        const { title, content } = req.body;

        const post = await BoardPost.findById(postId);

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        if (post.authorId !== req.session.user.id) {
            req.flash('error', '수정 권한이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        await BoardPost.findByIdAndUpdate(postId, { title, content });

        req.flash('success', '게시글이 수정되었습니다.');
        res.redirect(`/board/${postId}`);
    } catch (e) {
        console.error(e);
        req.flash('error', '글 수정 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.id}/edit`);
    }
});

/**
 * @swagger
 * /board/{id}/delete:
 *   delete:
 *     summary: 게시글 삭제
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: 삭제 성공 시 목록 / 실패 시 상세로 리다이렉트
 */
router.delete('/:id/delete', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        const post = await BoardPost.findById(postId);

        if (!post) {
            req.flash('error', '삭제할 글이 없습니다.');
            return res.redirect('/board');
        }

        if (req.session.user.isAdmin !== 1 && post.authorId !== req.session.user.id) {
            req.flash('error', '삭제 권한이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        await BoardPost.findByIdAndDelete(postId);
        await Comment.deleteMany({ post: postId });

        req.flash('success', '게시글이 삭제되었습니다.');
        res.redirect('/board');

    } catch (e) {
        console.error(e);
        req.flash('error', '글 삭제 중 오류가 발생했습니다.');
        res.redirect('/board');
    }
});


// -----------------------------
// 2. 댓글 (Comment)
// -----------------------------

/**
 * @swagger
 * /board/{id}/comments:
 *   post:
 *     summary: 댓글 생성
 *     tags: [Comment]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 부모 게시글 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 example: "댓글을 남깁니다."
 *     responses:
 *       302:
 *         description: 생성 성공 시 상세 페이지로 리다이렉트
 */
router.post('/:id/comments', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        const { content } = req.body;
        const { id: authorId, anonymousNickname: authorNickname } = req.session.user;

        if (!content) {
            req.flash('error', '댓글 내용을 입력해주세요.');
            return res.redirect(`/board/${postId}`);
        }

        const post = await BoardPost.findById(postId);
        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        const newComment = new Comment({
            content,
            authorId,
            authorNickname,
            post: postId
        });
        await newComment.save();

        post.comments.push(newComment._id);
        await post.save();

        if (post.authorId !== authorId) {
            const commentNotification = new Notification({
                userId: post.authorId, // 글 작성자에게 알림
                message: `'${post.title}' 게시글에 ${authorNickname} 님이 댓글을 남겼습니다.`,
                link: `/board/${postId}` // 해당 글로 이동하는 링크
            });
            await commentNotification.save();
        }

        req.flash('success', '댓글이 등록되었습니다.');
        res.redirect(`/board/${postId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 등록 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.id}`);
    }
});

/**
 * @swagger
 * /board/{postId}/comments/{commentId}:
 *   put:
 *     summary: 댓글 수정
 *     tags: [Comment]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 example: "수정한 댓글 내용"
 *     responses:
 *       302:
 *         description: 수정 성공 시 상세 페이지로 리다이렉트
 */
router.put('/:postId/comments/:commentId', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { postId, commentId } = req.params;
        const { content } = req.body;

        if (!content) {
            req.flash('error', '댓글 내용을 입력해주세요.');
            return res.redirect(`/board/${postId}`);
        }

        const comment = await Comment.findById(commentId);

        if (!comment) {
            req.flash('error', '수정할 댓글이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        if (comment.authorId !== req.session.user.id) {
            req.flash('error', '댓글 수정 권한이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        await Comment.findByIdAndUpdate(commentId, { content });

        req.flash('success', '댓글이 수정되었습니다.');
        res.redirect(`/board/${postId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 수정 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.postId}`);
    }
});

/**
 * @swagger
 * /board/{postId}/comments/{commentId}/delete:
 *   delete:
 *     summary: 댓글 삭제
 *     tags: [Comment]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: 삭제 성공 시 상세 페이지로 리다이렉트
 */
router.delete('/:postId/comments/:commentId/delete', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '로그인이 필요합니다.');
            return res.redirect('/auth/login');
        }

        const { postId, commentId } = req.params;
        const comment = await Comment.findById(commentId);

        if (!comment) {
            req.flash('error', '삭제할 댓글이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        if (req.session.user.isAdmin !== 1 && comment.authorId !== req.session.user.id) {
            req.flash('error', '삭제 권한이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        await Comment.findByIdAndDelete(commentId);

        await BoardPost.findByIdAndUpdate(postId, {
            $pull: { comments: commentId }
        });

        req.flash('success', '댓글이 삭제되었습니다.');
        res.redirect(`/board/${postId}`);

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 삭제 중 오류가 발생했습니다.');
        res.redirect(`/board/${postId}`);
    }
});

module.exports = router;
