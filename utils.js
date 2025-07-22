// 파일: utils.js (함수명은 유지, 내부만 listCard로 변경된 최종본)

/**
 * AI의 답변(mainText)과 확장 질문(questions)을 받아
 * 카카오톡 스킬 응답 형식(simpleText + listCard)으로 생성하는 함수
 * @param {string} mainText - AI가 생성한 주된 답변 텍스트.
 * @param {string[]} questions - AI가 생성한 2개 이상의 확장 질문 배열.
 * @returns {object} 카카오톡 스킬 응답 JSON 객체
 */
const createResponseFormat = (mainText, questions) => {
  return {
    version: "2.0",
    template: {
      outputs: [
        // 1. AI의 기본 답변을 전달하는 부분
        {
          simpleText: {
            text: mainText,
          },
        },
        // 2. 확장 질문을 리스트 카드로 보여주는 부분
        {
          listCard: {
            header: {
              title: "이런 점도 궁금하신가요? 🤖",
            },
            items: questions.map(q => ({
              title: q,
              action: 'message',
              messageText: q
            })),
          },
        },
      ],
    },
  };
};

/**
 * 카카오톡 서버에 '답변 생성 중'이라는 1차 대기 응답을 보내는 함수
 * (이 함수는 기존과 동일하게 유지됩니다)
 * @returns {object} 카카오톡 콜백 사용 응답 JSON 객체
 */
const createCallbackWaitResponse = () => {
    return {
        version: "2.0",
        useCallback: true,
        data: {
            text: "생각하고 있어요..."
        }
    };
};

// 두 함수를 다른 파일에서 사용할 수 있도록 export
module.exports = {
    createResponseFormat,
    createCallbackWaitResponse,
};
