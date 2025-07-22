// 파일: index.js

const express = require('express');
const { SYSTEM_PROMPT_HEALTH_CONSULT } = require('./prompt.js');
const { createResponseFormat, createCallbackWaitResponse } = require('./utils.js');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Gemini API를 호출하여 답변을 생성하는 함수
async function callGeminiForAnswer(userInput) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  
    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
    const body = {
        contents: [
            { role: 'user', parts: [{ text: SYSTEM_PROMPT_HEALTH_CONSULT }] },
            { role: 'model', parts: [{ text: "{\n  \"response_text\": \"네, 안녕하세요! Dr.LIKE입니다. 무엇을 도와드릴까요?\",\n  \"follow_up_questions\": [\n    \"아기가 열이 나요\",\n    \"신생아 예방접종 알려줘\"\n  ]\n}" }] }, // Few-shot example
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
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Gemini API 오류: ${response.status}`, errorBody);
        throw new Error('Gemini API 호출에 실패했습니다.');
    }

    const data = await response.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
}


// 백그라운드에서 실행될 비동기 작업 및 콜백 전송 함수
async function processAndCallback(userInput, callbackUrl) {
    let finalResponse;
    try {
        // 1. Gemini API 호출
        const aiResult = await callGeminiForAnswer(userInput);
        
        // 2. 카카오톡 응답 형식으로 가공
        finalResponse = createResponseFormat(
            aiResult.response_text,
            aiResult.follow_up_questions
        );

    } catch (error) {
        console.error('백그라운드 작업 중 오류 발생:', error);
        const errorText = "죄송해요, 답변을 생성하는 중 문제가 발생했어요. 잠시 후 다시 시도해주세요. 😥";
        finalResponse = createResponseFormat(errorText, ["다시 시작하기"]);
    }

    // 3. 콜백 URL로 최종 답변 전송
    await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalResponse),
    });
}


// 카카오 i 빌더 스킬 엔드포인트
app.post('/skill', async (req, res) => {
    const callbackUrl = req.body.userRequest?.callbackUrl;

    if (!callbackUrl) {
        // callbackUrl이 없는 구형 버전 요청은 직접 응답
        return res.status(400).json({
             version: "2.0",
             template: {
                 outputs: [{
                     simpleText: { text: "오류: 현재 사용 중인 버전에서는 이 기능을 지원하지 않아요." }
                 }]
             }
        });
    }

    // 1. 즉시 대기 응답 전송
    res.json(createCallbackWaitResponse());

    // 2. 비동기 작업 실행 (await 없음!)
    const userInput = req.body.userRequest.utterance;
    processAndCallback(userInput, callbackUrl);
});


app.get("/", (req, res) => {
    res.status(200).send("Dr.LIKE Health Consultation Bot (Callback Ready) is running!");
});

module.exports = app;