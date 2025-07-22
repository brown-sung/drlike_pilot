// 파일: utils.js

// 카카오톡 기본 텍스트 + 리스트 카드 응답 형식을 만드는 함수
const createResponseFormat = (mainText, questions) => {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: mainText,
          },
        },
      ],
      quickReplies: questions.map(q => ({
          action: "message",
          label: q,
          messageText: q,
      }))
    },
  };
};

// 카카오톡 1차 대기 응답 형식을 만드는 함수
const createCallbackWaitResponse = () => {
    return {
        version: "2.0",
        useCallback: true,
        data: {
            text: "네, 질문을 확인했어요. AI가 답변을 열심히 준비하고 있으니 잠시만 기다려주세요! 🤖"
        }
    };
};

module.exports = {
    createResponseFormat,
    createCallbackWaitResponse,
};