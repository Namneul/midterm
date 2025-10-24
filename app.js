const express = require('express');
const app = express();
const path = require('path');
const port = 3000;
const ejsMate = require('ejs-mate');

app.engine('ejs', ejsMate);

app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));

const mainRouter = require('./routes/main');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', mainRouter);

app.get('/', (req, res) => {
    res.send(__dirname + '/views/main.ejs');
});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});