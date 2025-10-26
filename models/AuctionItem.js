const mongoose = require('mongoose');

// 경매 아이템 스키마 정의
const auctionItemSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },

    // 1. 자료 업로드/다운로드 기능 [cite: 16]
    fileUrl: {
        type: String,
        required: true
    },
    fileType: {
        type: String,
        enum: ['image', 'pdf'], // JPG, PNG 등은 'image'로 묶고 PDF는 'pdf'로 구분
        required: true
    },

    // 2. 경매 정보 [cite: 14]
    startPrice: {
        type: Number,
        required: true,
        default: 0
    },
    endDate: {
        type: Date,
        required: true
    }, // 경매 마감 시간

    // 3. 판매자 정보 (MariaDB의 User와 연결)
    sellerId: {
        type: String, // MariaDB의 User ID (로그인한 req.session.user.id)
        required: true
    },
    sellerNickname: {
        type: String, // 익명 닉네임 [cite: 9]
        required: true
    },

    // 4. 실시간 경매 현황
    currentPrice: {
        type: Number,
        // 시작가를 현재가로 설정
        default: function() { return this.startPrice; }
    },
    highestBidderId: {
        type: String, // 현재 최고 입찰자의 MariaDB User ID
        default: null
    },

    // 경매 상태 (진행중, 종료 등)
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active'
    },

}, {
    // 생성/수정 시간 자동 기록
    timestamps: true
});

module.exports = mongoose.model('AuctionItem', auctionItemSchema);