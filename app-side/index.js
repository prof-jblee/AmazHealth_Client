import { BaseSideService } from '@zeppos/zml/base-side'

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      if(req.method === 'STEP_FILE') {
        const step_list = JSON.parse(req.params)

        for (const step_item of step_list) {
          const ts = step_item.ts
          const step_count = step_item.step_count          

          fetch(`https://269824b3a88d.ngrok-free.app/number?value=${step_count}&timestamp=${ts}`)
          .then((response) => {
            if(!response.ok) {
              throw new Error("서버 응답 오류")
            }
            return response.json()
          })
          .then((data) => {
            console.log("서버 응답:" + data)
            res(null, {result: data})
          })
          .catch((error) => {
            console.error("요청 실패:", error)
            res(null, {result: error})
          })        
        }        
      }
    },   
    onRun() {},
    onDestroy() {}
  })
)
