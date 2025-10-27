// models/db.js
const mariadb = require('mysql2/promise');

const pool = mariadb.createPool({
    host: 'localhost',
    port: 3366,
    user: 'appuser',
    password: '123123',
    database: `202110935`,
});

// 헬퍼: 쿼리(자동 커넥션/반납)
async function query(sql, params) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(sql, params);
        // mariadb 드라이버는 rows에 meta가 포함될 수 있음 -> 필요 시 가공
        return rows;
    } finally {
        if (conn) conn.release();
    }
}

module.exports = { pool, query };
