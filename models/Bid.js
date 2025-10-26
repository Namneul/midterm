const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const bidSchema = new Schema({
    // 1. 어느 경매 아이템에 대한 입찰인지
    auctionItem: {
        type: Schema.Types.ObjectId,
        ref: 'AuctionItem', // 'AuctionItem' 모델을 참조
        required: true
    },
    // 2. 누가 입찰했는지 (MariaDB 유저 정보)
    bidderId: {
        type: String,
        required: true
    },
    bidderNickname: { // 익명 닉네임
        type: String,
        required: true
    },
    // 3. 얼마에 입찰했는지
    price: {
        type: Number,
        required: true
    }
}, {
    // 4. 언제 입찰했는지 (자동 기록)
    timestamps: true
});

module.exports = mongoose.model('Bid', bidSchema);