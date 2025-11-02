import { parseQuery } from "../libs/utils"
import { log } from "@zos/utils"
import * as notificationMgr from "@zos/notification"
import * as appServiceMgr from "@zos/app-service"
import { Time } from "@zos/sensor";
import { Step, Screen, HeartRate, Sleep } from "@zos/sensor";
import { readFileSync, writeFileSync } from '@zos/fs'

const moduleName = "Time Service"
const SENSOR_FILE = 'sensor_data.json'        // /data 하위에 저장됨(앱별 샌드박스)
const WRITE_QUEUE = []                        // 쓰기 대기 큐 (화면이 켜진 상태에서는 파일을 쓸 수 없기 때문)
let isFlushing = false

const timeSensor = new Time()
const step = new Step()
const screen = new Screen()
const heartrate = new HeartRate()
const sleep = new Sleep()

const hr_list = []                            // 분당 심박수를 누적하기 위한 리스트
const step_list = []                          // 분당 걸음수를 누적하기 위한 리스트
const light_list = []                         // 분당 조도값을 누적하기 위한 리스트

const logger = log.getLogger("todo-list-page")

// 화면이 꺼져있을 때만 WRITE_QUEUE에 있는 내용을 파일로 저장
function flushStepQueue() {
  if (isFlushing || WRITE_QUEUE.length === 0) return
  isFlushing = true

  try {
    const text = readFileSync({ path: SENSOR_FILE, options: { encoding: 'utf8' } })
    const arr = text ? JSON.parse(text) : []

    // 큐 데이터 병합
    while (WRITE_QUEUE.length > 0) {
      arr.push(WRITE_QUEUE.shift())
    }

    writeFileSync({
      path: SENSOR_FILE,
      data: JSON.stringify(arr),
      options: { encoding: 'utf8' }
    })
    console.log('[AppService] flushStepQueue: saved records =', arr.length)
  } catch (e) {
    console.log('[AppService] flushStepQueue error:', e)
  } finally {
    isFlushing = false
  }
}

function appendSensorDataRecord() {

  const ts = Date.now()    
  const {score, startTime, endTime, totalTime} = sleep.getInfo()

  // 1) 10분 동안의 누적 걸음 수 구하기
  let step_count = 0
  if (step_list.length < 2) {
    console.error('걸음수 리스트에 걸음수 데이터가 1개 또는 비어 있습니다.')    
    step_count = 0
  } 
  
  step_count = step_list[step_list.length - 1] - step_list[0]   // 누적 걸음 수 계산 (=10분 후-10분 전)

  // 2) 10분 동안의 평균 심박수 구하기
  let heart_rate = 80
  if (hr_list.length === 0) {
    console.error('심박수 리스트가 비어 있습니다.')
  } else if (hr_list.length === 1) {
    heart_rate = hr_list[0]
  }

  hr_sum = hr_list.reduce((acc, cur) => acc + cur, 0)
  heart_rate = hr_sum / hr_list.length;

  // 3) 10분 동안의 평균 조도값 구하기
  let light = 0
  if (light_list === 0) {
    console.error('조도값 리스트가 비어 있습니다.')
    light = 0
  }

  light_sum = light_list.reduce((acc, cur) => acc + cur, 0)
  light = light_sum / light_list.length  

  // 4) awake 시간 구하기  
  const sleepStage = sleep.getStage()
  let awake_length = 0
  sleepStage.forEach((sleep_info) => {
    const { model, start, stop } = sleep_info

    if (model === sleep.getStageConstantObj().WAKE_STAGE) {
      awake_length += (Number(stop) - Number(start))
    }
  })

  const sleepLength = totalTime - awake_length    // 실제 수면 시간 구하기
  
  // 2) 새 레코드 추가
  const record = { ts, step_count, light, heart_rate, score, startTime, endTime, sleepLength, totalTime }

  // 3) 화면이 켜져 있으면 즉시 쓰기 금지 → 큐에 저장
  if (screen.getLight() > 0) {    
    console.log('Screen on is Checked')
    WRITE_QUEUE.push(record)
    console.log('[AppService] screen ON → queued record. queue size=', WRITE_QUEUE.length)

    // QUEUE에 들어갔으므로 각 리스트 비우기
    hr_list.length = 0    
    step_list.length = 0
    light_list.length = 0

    return
  }

  // 4) 화면 꺼져 있음 → 즉시 flush
  try {
    const text = readFileSync({ path: SENSOR_FILE, options: { encoding: 'utf8' } })
    const arr = text ? JSON.parse(text) : []
    arr.push(record)

    writeFileSync({
      path: SENSOR_FILE,
      data: JSON.stringify(arr),
      options: { encoding: 'utf8' }
    })
    console.log('[AppService] saved:', JSON.stringify(record))

    // 파일에 기록 했으므로 각 리스트 비우기
    hr_list.length = 0    
    step_list.length = 0
    light_list.length = 0

  } catch (e) {
    console.log('[AppService] write error:', e)
  }
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

    // 심박수는 onCurrentChange 함수를 호출해야 내부적으로 기록됨
    heartrate.onCurrentChange(() => { })

    // 화면 꺼질 때 flush
    screen.onChange(() => {
      console.log("Screen Status: ", screen.getStatus())
      if (screen.getStatus() === 2) {
        console.log('[AppService] screen OFF → flush queue')
        flushStepQueue()
      }
    })

    // 1분 간격 반복
    timeSensor.onPerMinute(() => {

      // 1분 간격으로 심박수 누적
      hr_1min = heartrate.getCurrent()
      hr_list.push(hr_1min)

      // 1분 간격으로 걸음 수 누적
      step_1min = step.getCurrent()
      step_list.push(step_1min)

      // 1분 간격으로 조도값 누적
      light_1min = screen.getLight()
      light_list.push(light_1min)

      // 10분 간격으로 실행하기 위한 코드
      const h = timeSensor.getHours()
      const m = timeSensor.getMinutes()
      
      if (m % 10 === 0) {
        logger.log(
          `${moduleName} time report: ${timeSensor.getHours()}:${timeSensor.getMinutes()}:${timeSensor.getSeconds()}`
        ),
        appendSensorDataRecord()
      }      
    })

    timeSensor.onPerDay(() => {
      logger.log(moduleName + " === day change ===")
    })
  },  
  onDestroy() {
    logger.log("service on destroy invoke")   
  },
})
