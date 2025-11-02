import { BaseSideService } from '@zeppos/zml/base-side'

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      if(req.method === 'SEND_DATA') {
        const step_list = JSON.parse(req.params)

        for (const step_item of step_list) {
          const ts = step_item.ts
          const step_count = step_item.step_count       
          const light = step_item.light   
          const heartrate = step_item.heart_rate
          const score = step_item.score          
          const startTime = step_item.startTime
          const endTime = step_item.endTime
          const sleepLength = step_item.sleepLength
          const totalTime = step_item.totalTime

          fetch(`https://aplitic-fully-alisa.ngrok-free.dev/number?timestamp=${ts}
                &step_count=${step_count}&light=${light}&heartrate=${heartrate}
                &score=${score}&startTime=${startTime}&endTime=${endTime}
                &sleepLength=${sleepLength}&totalTime=${totalTime}`)
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
