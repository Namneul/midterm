const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const buySellPostSchema = new Schema({
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },

    // [추가] 1. 거래 타입 ('sell': 팝니다, 'buy': 삽니다)
    postType: {
        type: String,
        enum: ['sell', 'buy'], // 'sell' 또는 'buy' 값만 허용
        required: true
    },

    // [추가] 2. 가격
    price: {
        type: Number,
        required: true,
        default: 0
    },

    // (자유게시판과 동일)
    authorId: {
        type: String,
        required: true
    },
    authorNickname: {
        type: String,
        required: true
    },
    authorReputation: {
        type: Number,
        default: 0
    },
    comments: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Comment' // 'Comment' 모델 참조
        }
    ],
    likes: [{
        type: String, // MariaDB User ID
        index: true
    }]

}, {
    timestamps: true
});

module.exports = mongoose.model('BuySellPost', buySellPostSchema);