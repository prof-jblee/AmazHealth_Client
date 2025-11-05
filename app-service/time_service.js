import { parseQuery } from "../libs/utils"
import { log } from "@zos/utils"
import * as notificationMgr from "@zos/notification"
import * as appServiceMgr from "@zos/app-service"
import { Time } from "@zos/sensor";
import { Step, Screen, HeartRate, Sleep } from "@zos/sensor";
import { readFileSync, writeFileSync } from '@zos/fs'

const moduleName = "Time Service"
const SENSOR_FILE = 'sensor_data.json'        // 수면 로그를 제외한 센서 데이터 기록 파일 (걸음 수, 심박수)
const SLEEP_FILE = 'sleep_data.json'          // 수면 로그 기록 파일
const SENSOR_DATA_QUEUE = []                  // 센서데이터 대기 큐 (화면이 켜진 상태에서는 파일을 쓸 수 없기 때문)
const SLEEP_LOG_QUEUE = []                    // 수면 로그 대기 큐
let isFlushing = false

const timeSensor = new Time()
const step = new Step()
const screen = new Screen()
const heartrate = new HeartRate()
const sleep = new Sleep()

// 워치에 기록된 수면 로그의 변화를 관찰하기 위한 변수
let prev_sleep_length = 0                     // 이전 순수 수면 시간 데이터
let prev_total_sleep_length = 0               // 이전 총 수면 시간 데이터

// 화면이 켜져 있는 상태에서 수면 로그를 파일로 기록하지 못해 notification을 보내면 안됨
// 이때는 해당 변수를 true로 만들어 화면이 꺼질 때 notification을 보낼 수 있도록 함
let isNotificationDelay = false               

const hr_list = []                            // 분당 심박수를 누적하기 위한 리스트
const step_list = []                          // 분당 걸음수를 누적하기 위한 리스트
const light_list = []                         // 분당 조도값을 누적하기 위한 리스트

const logger = log.getLogger("AmazHealth-service")

// 화면이 꺼져있을 때만 QUEUE에 있는 내용을 파일로 저장
function flushSensorDataQueue() {
  if (isFlushing || SENSOR_DATA_QUEUE.length === 0) return
  isFlushing = true

  try {
    const text = readFileSync({ path: SENSOR_FILE, options: { encoding: 'utf8' } })
    const arr = text ? JSON.parse(text) : []

    // 큐 데이터 병합
    while (SENSOR_DATA_QUEUE.length > 0) {
      arr.push(SENSOR_DATA_QUEUE.shift())
    }

    writeFileSync({
      path: SENSOR_FILE,
      data: JSON.stringify(arr),
      options: { encoding: 'utf8' }
    })
    console.log('[AppService] flushSensorDataQueue: saved records =', arr.length)
  } catch (e) {
    console.log('[AppService] flushSensorDataQueue error:', e)
  } finally {
    isFlushing = false
  }
}

// 화면이 꺼졌을 때 sleep log 큐에 있는 데이터를 파일로 기록
// 이때, notification이 딜레이 된 경우라면 notification을 보냄
function flushSleepLogQueue() {
  if (isFlushing || SLEEP_LOG_QUEUE.length === 0) return
  isFlushing = true

  try {
    const text = readFileSync({ path: SLEEP_FILE, options: { encoding: 'utf8' } })
    const arr = text ? JSON.parse(text) : []

    // 큐 데이터 병합
    while (SLEEP_LOG_QUEUE.length > 0) {
      arr.push(SLEEP_LOG_QUEUE.shift())
    }

    writeFileSync({
      path: SLEEP_FILE,
      data: JSON.stringify(arr),
      options: { encoding: 'utf8' }
    })
    console.log('[AppService] flushSleepLogQueue: saved records =', arr.length)

    // Sleep log를 10분마다 체크할 때, 화면이 켜져있는 상태였다면 바로 notification을 보내지 않아 여기서 보냄
    if(isNotificationDelay) {      
      isNotificationDelay = false
      notificationMgr.notify({
        title: "수면 로그 변화 관찰",
        content: `현재 새로운 수면 로그가 관찰되었습니다. 메인 화면으로 가서 데이터를 전송하세요.`,
        actions: [
          {
            text: "메인 화면",
            file: "page/home/index.page",
          },
        ],
      })
    }

  } catch (e) {
    console.log('[AppService] flushSleepLogQueue error:', e)
  } finally {
    isFlushing = false
  }
}

function appendSensorDataRecord(ts) {  

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
  
  // 4) 새 레코드 추가
  const sensor_record = { ts, step_count, light, heart_rate }
    
  // 5) 화면이 켜져 있으면 즉시 쓰기 금지 → 큐에 저장
  if (screen.getLight() > 0) {        
    SENSOR_DATA_QUEUE.push(sensor_record)    
    console.log('[AppService] screen ON → queued record. queue size=', SENSOR_DATA_QUEUE.length)

    // QUEUE에 들어갔으므로 각 리스트 비우기
    hr_list.length = 0    
    step_list.length = 0
    light_list.length = 0

    return
  }

  // 6) 화면 꺼져 있음 → 즉시 flush
  try {
    const text = readFileSync({ path: SENSOR_FILE, options: { encoding: 'utf8' } })
    const arr = text ? JSON.parse(text) : []
    arr.push(sensor_record)

    writeFileSync({
      path: SENSOR_FILE,
      data: JSON.stringify(arr),
      options: { encoding: 'utf8' }
    })
    console.log('[AppService] saved:', JSON.stringify(sensor_record))

    // 파일에 기록 했으므로 각 리스트 비우기
    hr_list.length = 0    
    step_list.length = 0
    light_list.length = 0

  } catch (e) {
    console.log('[AppService] write error:', e)
  }
}

function appendSleepLogRecord(ts) {
   
  const {score, startTime, endTime, totalTime} = sleep.getInfo()    // 수면 로그 데이터 가져오기

  // 수면 중 깬 시간 구하기  
  const sleepStage = sleep.getStage()
  let awake_length = 0
  sleepStage.forEach((sleep_info) => {
    const { model, start, stop } = sleep_info

    if (model === sleep.getStageConstantObj().WAKE_STAGE) {
      awake_length += (Number(stop) - Number(start))
    }
  })
  
  const sleepLength = totalTime - awake_length                       // 실제 수면 시간 구하기

  // 최초 기록된 실제 수면 시간 또는 총 수면 시간과 다르다면 prev_xxx 변수에 다시 기록하고 notification으로 알림
  if (prev_sleep_length !== sleepLength || prev_total_sleep_length !== totalTime) {
    prev_sleep_length = sleepLength
    prev_total_sleep_length = totalTime

    const sleep_record = { ts, score, startTime, endTime, sleepLength, totalTime }    

    // 화면이 켜져 있으면 즉시 쓰기 금지 → 큐에 저장
    if (screen.getLight() > 0) {        
      SLEEP_LOG_QUEUE.push(sleep_record)    
      isNotificationDelay = true;           // notification을 화면이 꺼졌을 때로 미룸
      console.log('[AppService] screen ON → queued record. queue size=', SLEEP_LOG_QUEUE.length)
      return
    }

    // 화면 꺼져 있음 → 즉시 flush
    try {
      const text = readFileSync({ path: SLEEP_FILE, options: { encoding: 'utf8' } })
      const arr = text ? JSON.parse(text) : []
      arr.push(sleep_record)

      writeFileSync({
        path: SLEEP_FILE,
        data: JSON.stringify(arr),
        options: { encoding: 'utf8' }
      })
      console.log('[AppService] saved:', JSON.stringify(sleep_record))
   
    } catch (e) {
      console.log('[AppService] write error:', e)
    }
    
    // 사용자 폰으로 알람 주기
    notificationMgr.notify({
      title: "수면 로그 변화 관찰",
      content: `현재 새로운 수면 로그가 관찰되었습니다. +키를 눌러 서버에 데이터를 전송하세요.`,
      actions: [
        {
          text: "Home Page",
          file: "page/home/index.page",
        },
      ],
    })
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

    // 화면 꺼질 때 flush 하는 콜백 함수 등록
    screen.onChange(() => {
      console.log("Screen Status: ", screen.getStatus())
      if (screen.getStatus() === 2) {
        console.log('[AppService] screen OFF → flush queue')
        flushSensorDataQueue()          // 센서 데이터 큐에 있는 내용을 파일로 기록
        flushSleepLogQueue()            // 슬립 로그 큐에 있는 내용을 파일로 기록
      }
    })

    // 심박수는 onCurrentChange 함수를 호출해야 내부적으로 기록됨
    heartrate.onCurrentChange(() => { })

    // 현재 워치에 기록된 실제 수면 시간, 총 수면시간 기록
    const {totalTime} = sleep.getInfo()     // 총 수면 시간
    
    // 수면 중 깬 시간 구하기  
    const sleepStage = sleep.getStage()
    let awake_length = 0
    sleepStage.forEach((sleep_info) => {
      const { model, start, stop } = sleep_info

      if (model === sleep.getStageConstantObj().WAKE_STAGE) {
        awake_length += (Number(stop) - Number(start))
      }
    })

    prev_total_sleep_length = totalTime             // 총 수면 시간
    prev_sleep_length = totalTime - awake_length    // 실제 수면 시간


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

      const ts = Date.now()       // 현재 시각 저장
      
      if (m % 10 === 0) {
        logger.log(
          `${moduleName} time report: ${timeSensor.getHours()}:${timeSensor.getMinutes()}:${timeSensor.getSeconds()}`
        ),
        appendSensorDataRecord(ts)        // 센서 데이터를 10분 간격으로 파일로 기록        
        appendSleepLogRecord(ts)          // 수면 로그를 10분 간격으로 관찰하여 변화가 감지되면 기록 후, 알람
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
