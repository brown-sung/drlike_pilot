// 파일: index.js (QStash를 이용한 진정한 비동기 처리 최종 코드)

const express = require('express');
const { Client } = require("@upstash/qstash"); // QStash 클라이언트 라이브러리
const { createResponseFormat, createCallbackWaitResponse } = require('./utils.js');
const { SYSTEM_PROMPT_HEALTH_CONSULT } = require('./prompt.js');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
app.use(express.json()); 

// --- 환경 변수에서 설정값 로드 ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const VERCEL_DEPLOYMENT_URL = process.env.VERCEL_URL; // Vercel이 자동으로 주입해주는 내 사이트의 공개 URL

// --- QStash 클라이언트 초기화 ---
const qstashClient = new Client({
  token: QSTASH_TOKEN,
});

// --- Gemini API 호출 함수 (이전과 동일) ---
async function callGeminiForAnswer(userInput) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
  
    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 작업 시간이 넉넉하므로 타임아웃을 25초로 늘림

    try {
        const body = { /* ... 이전 코드와 동일 ... */ };
        const response = await fetch(url, { /* ... 이전 코드와 동일 ... */ signal: controller.signal });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
        }
        const data = await response.json();
        return JSON.parse(data.candidates[0].content.parts[0].text);
    } catch (error) {
        if (error.name === 'AbortError') { throw new Error('Gemini API call timed out after 25 seconds.'); }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}


// =================================================================
//  엔드포인트 1: 카카오 요청 처리 (웨이터 역할)
// =================================================================
app.post('/skill', async (req, res) => {
    const userInput = req.body.userRequest?.utterance;
    const callbackUrl = req.body.userRequest?.callbackUrl;

    if (!userInput || !callbackUrl) {
        return res.status(400).json(createResponseFormat("잘못된 요청입니다.", []));
    }

    console.log('[/skill] Received request. Publishing job to QStash...');

    try {
        // QStash에 보낼 작업 내용(payload) 정의
        const jobPayload = {
            userInput: userInput,
            callbackUrl: callbackUrl
        };
        
        // 작업을 큐에 등록 (destination은 우리 서버의 /api/process-job 엔드포인트)
        await qstashClient.publishJSON({
            url: `https://${VERCEL_DEPLOYMENT_URL}/api/process-job`, // Vercel의 전체 URL + 주방장 엔드포인트 경로
            body: jobPayload,
        });

        // 작업 등록 후, 카카오 서버에 즉시 '대기 응답'을 보냄
        return res.json(createCallbackWaitResponse());

    } catch (error) {
        console.error("[/skill] Failed to publish job to QStash:", error);
        return res.status(500).json(createResponseFormat("시스템 오류로 작업을 시작하지 못했어요. 다시 시도해주세요.", []));
    }
});


// =================================================================
//  엔드포인트 2: QStash로부터 작업을 받아 실제 처리 (주방장 역할)
// =================================================================
app.post('/api/process-job', async (req, res) => {
    console.log('[/api/process-job] Received job from QStash.');
    
    try {
        const { userInput, callbackUrl } = req.body;
        console.log(`[/api/process-job] Processing job for: "${userInput}"`);

        // 시간이 오래 걸리는 Gemini API 호출 실행
        const aiResult = await callGeminiForAnswer(userInput);
        
        // 최종 응답 포맷 생성
        const finalResponse = createResponseFormat(
            aiResult.response_text,
            aiResult.follow_up_questions
        );

        // 최종 결과를 카카오 콜백 URL로 전송
        await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalResponse),
        });
        
        console.log('[/api/process-job] Job processed and callback sent successfully.');
        // QStash에게 "작업 성공" 신호 전송
        return res.status(200).send("Job processed successfully.");

    } catch (error) {
        console.error("[/api/process-job] Error processing job:", error);
        // QStash에게 "작업 실패" 신호를 보내면, QStash가 설정에 따라 재시도함
        return res.status(500).send("Failed to process job.");
    }
});


app.get("/", (req, res) => {
    res.status(200).send("Dr.LIKE Health Consultation Bot (QStash Ready) is running!");
});

module.exports = app;
