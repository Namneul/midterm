const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const chatPostSchema = new Schema({
    content: {
        type: String,
        required: true
    },
    // 1. 작성자 (MariaDB ID, 나중에 '삭제' 버튼용)
    authorId: {
        type: String,
        required: true
    },
    // 2. 익명 번호 (예: 1, 2, 3...)
    // 이 게시판 내에서만 사용될 임시 번호입니다.
    anonymousNumber: {
        type: Number,
        required: true,
        index: true // 정렬을 위해 인덱스 추가
    }
}, {
    // 3. 작성 시간 (자동 기록)
    timestamps: true
});

chatPostSchema.index({ createdAt: 1 }, { expireAfterSeconds: 43200 });

module.exports = mongoose.model('ChatPost', chatPostSchema);