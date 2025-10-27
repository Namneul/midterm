// swagger.js
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Swagger 기본 설정
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: '족보 경매 웹사이트 API 문서',
            version: '1.0.0',
            description: 'Express 기반 API 명세서 (by Swagger)',
        },
        servers: [
            {
                url: 'http://localhost:3000', // 개발용 서버 주소
            },
        ],
    },
    apis: ['./routes/*.js'], // 주석을 읽을 파일 경로
};

const specs = swaggerJsDoc(options);

module.exports = { swaggerUi, specs };
