const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const notificationSchema = new Schema({
    // 1. 알림을 받을 사용자 (MariaDB ID)
    userId: {
        type: String,
        required: true,
        index: true // 조회를 위해 인덱스 추가
    },
    // 2. 알림 메시지 내용
    message: {
        type: String,
        required: true
    },
    // 3. 관련 링크 (클릭 시 이동할 경로, 옵션)
    link: {
        type: String,
        default: null
    },
    // 4. 읽음 여부 (기본값: false)
    isRead: {
        type: Boolean,
        default: false,
        index: true // 읽지 않은 알림 조회를 위해 인덱스 추가
    }
}, {
    // 5. 생성 시간 (자동 기록)
    timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);