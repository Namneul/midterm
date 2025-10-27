const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const commentSchema = new Schema({
    content: {
        type: String,
        required: true
    },

    // 1. 작성자 (MariaDB ID - 삭제 권한 확인용)
    authorId: {
        type: String,
        required: true
    },
    // 2. 작성자 (고정 익명 닉네임 - 화면 표시용)
    authorNickname: {
        type: String,
        required: true
    },

    // 3. 이 댓글이 어떤 게시글에 속해 있는지
    // BoardPost 모델의 ObjectId를 저장합니다.
    post: {
        type: Schema.Types.ObjectId,
        ref: 'BoardPost', // 'BoardPost' 모델 참조
        required: true
    }
}, {
    // 생성 시간 자동 기록
    timestamps: true
});

module.exports = mongoose.model('Comment', commentSchema);