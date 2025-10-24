const express  = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('main', {
        title:"메인"
    });
});

router.get('/auth/login', (req, res) => {
    res.render('login-signup', {
        title:"로그인/회원가입"
    });
});

router.get('/profile', (req, res) => {
    res.render('profile', {
        title:"프로필"
    });
});


module.exports = router;