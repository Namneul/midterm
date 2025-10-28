const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const boardPostSchema = new Schema({
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },

    // 1. 작성자 (MariaDB ID - 삭제/수정 권한 확인용)
    authorId: {
        type: String,
        required: true
    },
    // 2. 작성자 (고정 익명 닉네임 - 화면 표시용)
    authorNickname: {
        type: String,
        required: true
    },
    // (선택) 평판 점수 스냅샷
    authorReputation: {
        type: Number,
        default: 0
    },

    // 3. 이 게시글에 달린 댓글들
    // Comment 모델의 ObjectId가 배열로 저장됩니다.
    comments: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Comment' // 'Comment' 모델 참조
        }
    ],
    likes: [{
        type: String, // MariaDB User ID
        index: true   // 특정 사용자가 좋아요 눌렀는지 빠르게 찾기 위해
    }]
}, {
    // 생성/수정 시간 자동 기록
    timestamps: true
});

module.exports = mongoose.model('BoardPost', boardPostSchema);