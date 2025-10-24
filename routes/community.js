const express  = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('community', {
        title:"몰라"
    });
});

router.get('/auction', (req, res) => {
    res.render('auction', {
        title:"경매"
    });
});

router.get('/buy-sell', (req, res) => {
    res.render('buy-sell', {
        title:"팝니다 삽니다"
    });
});

router.get('/chat', (req, res) => {
    res.render('chat', {
        title:"자유수다"
    });
});

module.exports = router;