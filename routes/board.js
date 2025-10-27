const express = require('express');
const router = express.Router();
const BoardPost = require('../models/BoardPost');
const Comment = require('../models/Comment');

// -----------------------------
// 1. 게시글 (Post)
// -----------------------------

// GET /board - 글 목록 (페이지네이션)
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = 20; // 한 페이지에 20개
        const skip = (page - 1) * limit;

        // .sort() : 최신순
        // .skip() : 건너뛰기
        // .limit() : 20개만 가져오기
        const posts = await BoardPost.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalPosts = await BoardPost.countDocuments();
        const totalPages = Math.ceil(totalPosts / limit);

        res.render('board', { // ⭐️ 3단계: views/board.ejs (신규)
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

// GET /board/new - 글쓰기 폼
router.get('/new', (req, res) => {
    if (!req.session.user) {
        req.flash('error', '로그인이 필요합니다.');
        return res.redirect('/auth/login?redirect=/board/new');
    }
    res.render('board-new', { // ⭐️ 3단계: views/board-new.ejs (신규)
        title: "새 글 작성"
    });
});

// POST /board - 글 생성 처리
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
            authorReputation // 평판 점수 스냅샷 저장
        });

        await newPost.save();

        req.flash('success', '글이 성공적으로 등록되었습니다.');
        res.redirect(`/board/${newPost._id}`); // ⭐️ 방금 만든 글로 이동

    } catch (e) {
        console.error(e);
        req.flash('error', '글 등록 중 오류가 발생했습니다.');
        res.redirect('/board/new');
    }
});

// GET /board/:id - 글 상세보기 (댓글 포함)
router.get('/:id', async (req, res) => {
    try {
        const post = await BoardPost.findById(req.params.id)
            .populate('comments'); // ⭐️ 댓글 정보 로드

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        res.render('board-detail', { // ⭐️ 3단계: views/board-detail.ejs (신규)
            title: post.title,
            post: post
        });
    } catch (e) {
        console.error(e);
        req.flash('error', '게시글을 불러오는 데 실패했습니다.');
        res.redirect('/board');
    }
});

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

        // [권한] 본인 글이 아니면 수정 폼에 진입 불가
        if (post.authorId !== req.session.user.id) {
            req.flash('error', '수정 권한이 없습니다.');
            return res.redirect(`/board/${req.params.id}`);
        }

        // ⭐️ 2단계: 'views/board-edit.ejs' 렌더링 (post 객체 전달)
        res.render('board-edit', {
            title: "게시글 수정",
            post: post
        });

    } catch (e) {
        console.error(e);
        res.redirect(`/board/${req.params.id}`);
    }
});

router.put('/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { id: postId } = req.params;
        const { title, content } = req.body; // ⭐️ 수정된 제목/내용

        const post = await BoardPost.findById(postId);

        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        // [권한] 본인 글이 아니면 수정 처리 불가
        if (post.authorId !== req.session.user.id) {
            req.flash('error', '수정 권한이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        // [DB] ⭐️ 'findByIdAndUpdate'로 수정
        await BoardPost.findByIdAndUpdate(postId, {
            title: title,
            content: content
        });

        req.flash('success', '게시글이 수정되었습니다.');
        res.redirect(`/board/${postId}`); // ⭐️ 수정된 '상세 페이지'로 복귀

    } catch (e) {
        console.error(e);
        req.flash('error', '글 수정 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.id}/edit`);
    }
});

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
        // ⭐️ 관리자가 아니면서, 본인 글도 아닐 때
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

// POST /board/:id/comments - 댓글 생성
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

        // 1. 부모 게시글 찾기
        const post = await BoardPost.findById(postId);
        if (!post) {
            req.flash('error', '게시글을 찾을 수 없습니다.');
            return res.redirect('/board');
        }

        // 2. 댓글 생성
        const newComment = new Comment({
            content,
            authorId,
            authorNickname,
            post: postId // 부모 post의 id
        });
        await newComment.save();

        // 3. 부모 게시글의 'comments' 배열에 새 댓글의 ID를 추가
        post.comments.push(newComment._id);
        await post.save();

        req.flash('success', '댓글이 등록되었습니다.');
        res.redirect(`/board/${postId}`); // 상세보기 페이지로 새로고침

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 등록 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.id}`);
    }
});

router.put('/:postId/comments/:commentId', async (req, res) => {
    try {
        if (!req.session.user) {
            req.flash('error', '세션이 만료되었습니다.');
            return res.redirect('/auth/login');
        }

        const { postId, commentId } = req.params;
        const { content } = req.body; // ⭐️ 폼에서 받은 '새' 내용

        if (!content) {
            req.flash('error', '댓글 내용을 입력해주세요.');
            return res.redirect(`/board/${postId}`);
        }

        const comment = await Comment.findById(commentId);

        if (!comment) {
            req.flash('error', '수정할 댓글이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        // [권한] 본인 댓글이 아니면 수정 불가
        if (comment.authorId !== req.session.user.id) {
            req.flash('error', '댓글 수정 권한이 없습니다.');
            return res.redirect(`/board/${postId}`);
        }

        // [DB] ⭐️ 댓글 내용(content) 업데이트
        await Comment.findByIdAndUpdate(commentId, { content: content });

        req.flash('success', '댓글이 수정되었습니다.');
        res.redirect(`/board/${postId}`); // ⭐️ 상세 페이지로 복귀

    } catch (e) {
        console.error(e);
        req.flash('error', '댓글 수정 중 오류가 발생했습니다.');
        res.redirect(`/board/${req.params.postId}`);
    }
});

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
        // ⭐️ 관리자가 아니면서, 본인 댓글도 아닐 때
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