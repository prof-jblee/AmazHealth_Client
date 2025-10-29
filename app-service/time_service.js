import { parseQuery } from "../libs/utils"
import { log } from "@zos/utils"
import * as notificationMgr from "@zos/notification"
import * as appServiceMgr from "@zos/app-service"
import { Time } from "@zos/sensor";
import { Step } from "@zos/sensor";
import { readFileSync, writeFileSync } from '@zos/fs'

const moduleName = "Time Service"
const timeSensor = new Time()

const STEP_FILE = 'steps.json'        // /data 하위에 저장됨(앱별 샌드박스)
const step = new Step()

const logger = log.getLogger("todo-list-page")

function appendStepRecord() {

  const ts = Date.now()
  const step_count = step.getCurrent()

  // 1) 기존 파일 내용 읽기(없으면 빈 배열)
  let arr = []
  try {
    const text = readFileSync({ path: STEP_FILE, options: { encoding: 'utf8' } })
    if (text) arr = JSON.parse(text)
  } catch (e) {
    // 파일이 없거나 JSON 파싱 실패 → 새로 시작
    console.log('Step 파일이 존재하지 않습니다. 새 파일에 기록을 시작합니다.')
    arr = []
  }

  // 2) 새 레코드 추가
  arr.push({ ts, step_count })

  // 3) 덮어쓰기 저장
  writeFileSync({
    path: STEP_FILE,
    data: JSON.stringify(arr),
    options: { encoding: 'utf8' }
  })

  console.log('[AppService] saved:', JSON.stringify(arr))
}

// Send a notification
function sendNotification() {  
  logger.log("send notification")
  
  // notificationMgr.notify({
  //   title: "Time Service",
  //   content: `Now the time is ${timeSensor.getHours()}:${timeSensor.getMinutes()}:${timeSensor.getSeconds()}`,
  //   actions: [
  //     {
  //       text: "Home Page",
  //       file: "page/home/index.page",
  //     },
  //     {
  //       text: "Stop Service",
  //       file: "app-service/time_service",
  //       param: "action=exit", //! processed in onEvent()
  //     },
  //   ],
  // });
}

AppService({
  onEvent(e) {
    logger.log(`service onEvent(${e})`)
    let result = parseQuery(e)
    if (result.action === "exit") {
      appServiceMgr.exit()
    }
  },
  onInit(e) {
    logger.log(`service onInit(${e})`)

    appendStepRecord()

    // 1분 간격으로 걸음 수 기록
    timeSensor.onPerMinute(() => {

      // // 10분 간격으로 실행하기 위한 코드
      // const h = timeSensor.getHours()
      // const m = timeSensor.getMinutes()
      
      // if (m % 10 === 0) {
      //   logger.log(
      //     `${moduleName} time report: ${timeSensor.getHours()}:${timeSensor.getMinutes()}:${timeSensor.getSeconds()}`
      //   ),
      //   appendStepRecord()
      // }

      logger.log(
        `${moduleName} time report: ${timeSensor.getHours()}:${timeSensor.getMinutes()}:${timeSensor.getSeconds()}`
      ),
      appendStepRecord()
    })

    timeSensor.onPerDay(() => {
      logger.log(moduleName + " === day change ===")
    })
  },
  onRequest, // Device App이 request로 당겨갈 수 있게
  onDestroy() {
    logger.log("service on destroy invoke")   
  },
})
