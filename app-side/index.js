import { BaseSideService } from '@zeppos/zml/base-side'

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      if(req.method === 'SEND_DATA') {
        // [수정] 변수 하나하나 꺼내지 말고, 받은 내용 통째로 보냅니다.
        const jsonBody = req.params 

        // [수정] GET 대신 PATCH + Body 사용
        fetch('http://127.0.0.1:3000/steps', { 
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: jsonBody
        })
          .then((response) => {
            if(!response.ok) {
              throw new Error("서버 응답 오류")
            }
            return response.json()
          })
          .then((data) => {
            console.log("서버 응답:" + JSON.stringify(data))
            res(null, {result: data})
          })
          .catch((error) => {
            console.error("요청 실패:", error)
            res(null, {result: error})
          })        
      }
    },   
    onRun() {},
    onDestroy() {}
  })
)