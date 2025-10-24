const express  = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('main', {
        title:"몰라"
    });
});

module.exports = router;