// 파일: index.js (QStash + gemini-pro 적용 최종 완성본)

// ----------------------------------------------------------------
//  1. 모듈 및 라이브러리 로드
// ----------------------------------------------------------------
const express = require('express');
const { Client } = require("@upstash/qstash"); // QStash 클라이언트 라이브러리
const { createResponseFormat, createCallbackWaitResponse } = require('./utils.js');
const { SYSTEM_PROMPT_HEALTH_CONSULT } = require('./prompt.js');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));


// ----------------------------------------------------------------
//  2. 애플리케이션 및 클라이언트 초기화
// ----------------------------------------------------------------
const app = express();
app.use(express.json()); 

// 환경 변수에서 설정값 로드
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const VERCEL_DEPLOYMENT_URL = process.env.VERCEL_URL; // Vercel이 자동으로 주입하는 내 사이트의 공개 URL

// QStash 클라이언트 초기화
// 토큰이 없으면 초기화하지 않고, 에러를 발생시켜 문제를 빨리 인지하도록 함
if (!QSTASH_TOKEN) {
  throw new Error("QSTASH_TOKEN is not defined in environment variables.");
}
const qstashClient = new Client({
  token: QSTASH_TOKEN,
});


// ----------------------------------------------------------------
//  3. 핵심 로직 함수: Gemini API 호출
// ----------------------------------------------------------------
async function callGeminiForAnswer(userInput) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
  
    // [최종 수정] 안정적인 gemini-pro 모델로 변경
    const model = 'gemini-pro'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    // 백그라운드 작업이므로 타임아웃을 25초로 넉넉하게 설정
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); 

    try {
        const body = {
            contents: [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT_HEALTH_CONSULT }] },
                { role: 'model', parts: [{ text: "{\n  \"response_text\": \"네, 안녕하세요! Dr.LIKE입니다. 무엇을 도와드릴까요?\",\n  \"follow_up_questions\": [\n    \"아기가 열이 나요\",\n    \"신생아 예방접종 알려줘\"\n  ]\n}" }] },
                { role: 'user', parts: [{ text: userInput }] }
            ],
            generationConfig: {
                temperature: 0.7,
                response_mime_type: "application/json",
            },
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
        }
        
        const data = await response.json();
        const rawText = data.candidates[0].content.parts[0].text;
        return JSON.parse(rawText);

    } catch (error) {
        if (error.name === 'AbortError') { 
            throw new Error('Gemini API call timed out after 25 seconds.'); 
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}


// ----------------------------------------------------------------
//  4. API 엔드포인트 정의
// ----------------------------------------------------------------

/**
 * 엔드포인트 1: /skill (웨이터 역할)
 * - 카카오톡의 요청을 최초로 받습니다.
 * - 처리할 작업을 QStash 큐에 등록합니다.
 * - 카카오톡에 즉시 '대기 응답'을 보냅니다.
 */
app.post('/skill', async (req, res) => {
    const userInput = req.body.userRequest?.utterance;
    const callbackUrl = req.body.userRequest?.callbackUrl;

    if (!userInput || !callbackUrl) {
        return res.status(400).json(createResponseFormat("잘못된 요청입니다.", []));
    }

    console.log('[/skill] Received request. Publishing job to QStash...');

    try {
        const jobPayload = {
            userInput: userInput,
            callbackUrl: callbackUrl
        };
        
        await qstashClient.publishJSON({
            url: `https://${VERCEL_DEPLOYMENT_URL}/api/process-job`,
            body: jobPayload,
        });

        return res.json(createCallbackWaitResponse());

    } catch (error) {
        console.error("[/skill] Failed to publish job to QStash:", error);
        return res.status(500).json(createResponseFormat("시스템 오류로 작업을 시작하지 못했어요. 다시 시도해주세요.", []));
    }
});

/**
 * 엔드포인트 2: /api/process-job (주방장 역할)
 * - QStash로부터 작업을 전달받아 실제 처리를 수행합니다.
 * - 시간이 오래 걸리는 Gemini API 호출을 여기서 담당합니다.
 * - 처리가 완료되면 카카오 콜백 URL로 최종 결과를 전송합니다.
 */
app.post('/api/process-job', async (req, res) => {
    console.log('[/api/process-job] Received job from QStash.');
    
    try {
        const { userInput, callbackUrl } = req.body;
        console.log(`[/api/process-job] Processing job for: "${userInput}"`);

        const aiResult = await callGeminiForAnswer(userInput);
        const finalResponse = createResponseFormat(
            aiResult.response_text,
            aiResult.follow_up_questions
        );

        await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalResponse),
        });
        
        console.log('[/api/process-job] Job processed and callback sent successfully.');
        return res.status(200).send("Job processed successfully.");

    } catch (error) {
        console.error("[/api/process-job] Error processing job:", error.message);
        return res.status(500).send("Failed to process job.");
    }
});

/**
 * 엔드포인트 3: / (헬스 체크 역할)
 * - 서버가 살아있는지 간단히 확인하는 용도입니다.
 */
app.get("/", (req, res) => {
    res.status(200).send("Dr.LIKE Health Consultation Bot (QStash Ready & Stable) is running!");
});


// ----------------------------------------------------------------
//  5. 애플리케이션 내보내기
// ----------------------------------------------------------------
module.exports = app;
