import { parseQuery } from "../libs/utils"
import { log } from "@zos/utils"
import * as notificationMgr from "@zos/notification" // !기상 알림 매니저
import * as appServiceMgr from "@zos/app-service"
import { Time } from "@zos/sensor";
import { Step, Screen, HeartRate, Sleep, Wear } from "@zos/sensor"; 
import { readFileSync, writeFileSync } from '@zos/fs' 

const moduleName = "Time Service"
const SENSOR_FILE = 'sensor_data.json'
const SLEEP_FILE = 'sleep_data.json'
const SENSOR_DATA_QUEUE = []
const SLEEP_LOG_QUEUE = []
let isFlushing = false

const timeSensor = new Time()
const step = new Step()
const screen = new Screen()
const heartrate = new HeartRate()
const wear = new Wear()

// !실제 수면 센서 사용
const sleep = new Sleep() 

// !수면 데이터 변화 감지를 위한 변수
let prev_endTime = 0; // !이전 수면 종료 시간
let prev_nap_stop = 0; // !이전 낮잠 종료 시간

// !안정화(Stability) 대기 로직 변수
let pending_sleep_record = null; // !변동 중인 데이터를 임시 보관하는 변수
let stability_count = 0; // !데이터가 변하지 않은 횟수 (30분 체크용)

let isNotificationDelay = false               
let last_step_count = 0; 

const hr_list = []
const step_list = []
const light_list = []

const logger = log.getLogger("AmazHealth-service")

function safeReadFile(path) {
  try {
    const text = readFileSync({ path: path, options: { encoding: 'utf8' } })
    return text ? JSON.parse(text) : []
  } catch (e) {
    return []
  }
}

function flushSensorDataQueue() {
  if (isFlushing || SENSOR_DATA_QUEUE.length === 0) return
  isFlushing = true
  try {
    const arr = safeReadFile(SENSOR_FILE)
    while (SENSOR_DATA_QUEUE.length > 0) {
      arr.push(SENSOR_DATA_QUEUE.shift())
    }
    writeFileSync({ path: SENSOR_FILE, data: JSON.stringify(arr), options: { encoding: 'utf8' } })
    console.log('[AppService] flushSensorDataQueue: Saved.')
  } catch (e) {
    console.log('[AppService] flushSensorDataQueue error:', e)
  } finally {
    isFlushing = false
  }
}

function flushSleepLogQueue() {
  if (isFlushing || SLEEP_LOG_QUEUE.length === 0) return
  isFlushing = true
  try {
    const arr = safeReadFile(SLEEP_FILE)
    while (SLEEP_LOG_QUEUE.length > 0) {
      arr.push(SLEEP_LOG_QUEUE.shift())
    }
    writeFileSync({ path: SLEEP_FILE, data: JSON.stringify(arr), options: { encoding: 'utf8' } })
    console.log('[AppService] flushSleepLogQueue: Saved.')

    if(isNotificationDelay) {      
      isNotificationDelay = false
      notificationMgr.notify({
        title: "수면/기상 확정", // !알림 제목
        content: `수면 상태가 완전히 종료되었습니다.`, // !알림 내용
        actions: [{ text: "메인 화면", file: "page/home/index.page" }],
      })
    }
  } catch (e) {
    console.log('[AppService] flushSleepLogQueue error:', e)
  } finally {
    isFlushing = false
  }
}

function appendSensorDataRecord(ts) {  
  try {
    // !걸음 수 계산 (누적값의 차이)
    const current_step_total = step.getCurrent();
    let step_count = current_step_total - last_step_count;
    if (step_count < 0) step_count = 0; 
    last_step_count = current_step_total; 

    // !심박수 평균
    let heart_rate = 80
    if (hr_list.length > 0) {
       let hr_sum = hr_list.reduce((acc, cur) => acc + cur, 0)
       heart_rate = Math.round(hr_sum / hr_list.length);
    }

    // !조도 평균
    let light = 0
    if (light_list.length > 0) {
       let light_sum = light_list.reduce((acc, cur) => acc + cur, 0)
       light = Math.round(light_sum / light_list.length)
    }
    
    // !휴식기 심박수
    let resting_hr = 0
    try { resting_hr = heartrate.getResting() || 0 } catch(e) {}

    const sensor_record = { ts, step_count, light, heart_rate, resting_hr }
      
    // 화면이 켜져있을 때는 Queue에 임시로 넣기
    if (screen.getStatus() === 1) {        
      SENSOR_DATA_QUEUE.push(sensor_record)    
      hr_list.length = 0; 
      step_list.length = 0; 
      light_list.length = 0
      return
    }

    const arr = safeReadFile(SENSOR_FILE)
    arr.push(sensor_record)
    writeFileSync({ path: SENSOR_FILE, data: JSON.stringify(arr), options: { encoding: 'utf8' } })
    console.log('[AppService] saved SENSOR:', JSON.stringify(sensor_record))

    hr_list.length = 0; 
    step_list.length = 0; 
    light_list.length = 0

  } catch (e) {
    console.log('[AppService] appendSensorDataRecord ERROR:', e)
  }
}

// !수면 데이터 변화 감지 및 안정화 로직 (5분마다 실행)
function appendSleepLogRecord(ts) { 
  try {
    // !1. 현재 수면 정보(메인) 확인
    const info = sleep.getInfo() || {};
    const currentEndTime = info.endTime || 0;
    const currentTotalTime = info.totalTime || 0;

    // !2. 낮잠 정보 확인 (마지막 낮잠의 종료 시간)
    const napArray = sleep.getNap() || [];
    let currentNapStop = 0;
    if (Array.isArray(napArray) && napArray.length > 0) {
        const lastNap = napArray[napArray.length - 1]; 
        currentNapStop = lastNap.stop || 0;
    }

    // !3. 변화 감지: "이전 기록과 시간이 달라졌는가?"
    const isMainSleepChanged = (currentEndTime > 0 && currentEndTime !== prev_endTime);
    const isNapChanged = (currentNapStop > 0 && currentNapStop !== prev_nap_stop);

    // !CASE A: 데이터가 변하고 있음 (아직 자는 중이거나 워치가 데이터 처리 중)
    if (isMainSleepChanged || isNapChanged) {
        console.log(`[SleepCheck] 데이터 갱신 감지! (안정화 대기 시작)`);
        
        // !데이터 수집 및 임시 변수(pending)에 덮어쓰기
        const {score, startTime} = info;
        
        // !수면 단계 처리
        const sleepStage = sleep.getStage() || [];
        let awake_length = 0;
        if (Array.isArray(sleepStage)) {
            sleepStage.forEach((sleep_info) => {
                const { model, start, stop } = sleep_info
                if (model === sleep.getStageConstantObj().WAKE_STAGE) {
                    awake_length += (Number(stop) - Number(start))
                }
            })
        }
        const sleepLength = currentTotalTime - awake_length; 
        
        // !배열 데이터 통째로 저장
        const naps = sleep.getNap() || [];
        const stages = sleep.getStage() || [];

        // !최신 상태를 임시 저장 (아직 파일에 안 씀)
        pending_sleep_record = { 
            ts, score: score || 0, startTime: startTime || 0, endTime: currentEndTime, totalTime: currentTotalTime, sleepLength, 
            naps, stages  
        };

        // !데이터가 변했으므로 카운트 리셋 (다시 0부터 카운트)
        stability_count = 0; 
        
        // !기준점 업데이트 (다음 비교를 위해)
        if (currentEndTime > 0) prev_endTime = currentEndTime;
        if (currentNapStop > 0) prev_nap_stop = currentNapStop;

        return; // !함수 종료
    }

    // !CASE B: 데이터가 변하지 않음 (안정화 진행 중)
    if (pending_sleep_record !== null) {
        stability_count++;
        // !5분마다 실행되므로 count가 6이면 30분이 지난 것임
        console.log(`[SleepCheck] 데이터 안정화 중... (${stability_count}/6)`); 

        // !4. 저장 확정 트리거 (30분 경과)
        if (stability_count >= 6) {
            console.log('[AppService] !수면 데이터 확정! (30분 유지됨 -> 저장)');

            const final_record = pending_sleep_record;

            if (screen.getLight() > 0) {        
                SLEEP_LOG_QUEUE.push(final_record)    
                isNotificationDelay = true;           
                console.log('[AppService] !화면 켜짐: 큐에 저장')
            } else {
                const arr = safeReadFile(SLEEP_FILE)
                arr.push(final_record)
                writeFileSync({ path: SLEEP_FILE, data: JSON.stringify(arr), options: { encoding: 'utf8' } })
                console.log('[AppService] !파일 저장 완료 (Sleep Log Saved)')
                
                // !기상 확정 알림 발송
                notificationMgr.notify({
                    title: "수면/기상 확정",
                    content: `30분 동안 변동이 없어 수면 기록을 저장했습니다.`,
                    actions: [{ text: "메인 화면", file: "page/home/index.page" }],
                })
            }

            // !저장 완료 후 초기화 (중복 저장 방지)
            pending_sleep_record = null;
            stability_count = 0;
        }
    }

  } catch (e) {
    console.log('[AppService] appendSleepLogRecord ERROR:', e)
  }
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

    screen.onChange(() => {
      console.log("Screen Status: ", screen.getStatus())
      if (screen.getStatus() === 2) { 
        flushSensorDataQueue()          
        flushSleepLogQueue()            
      }
    })

    heartrate.onCurrentChange(() => { })

    // !앱 시작 시 초기값 설정 (오알림 방지용)
    try {
        const info = sleep.getInfo();
        if (info && info.endTime) prev_endTime = info.endTime;

        const napArray = sleep.getNap();
        if (Array.isArray(napArray) && napArray.length > 0) {
            prev_nap_stop = napArray[napArray.length - 1].stop || 0;
        }
        console.log(`[AppService] Init prev_endTime: ${prev_endTime}, prev_nap_stop: ${prev_nap_stop}`);
    } catch(e) { 
        console.log('[AppService] Init Sleep Info Error');
    }
    
    last_step_count = step.getCurrent();

    timeSensor.onPerMinute(() => {
      try {
        let hr_1min = heartrate.getCurrent()
        hr_list.push(hr_1min)
        let light_1min = screen.getLight()
        light_list.push(light_1min)

        const ts = Date.now()
        const m = timeSensor.getMinutes()
        
        // !매 10분마다 센서 데이터 저장 (0, 10, 20...)
        if (m % 10 === 0) {
          logger.log(`${moduleName} Sensor Report (10min interval)`);
          appendSensorDataRecord(ts)                  
        }

        // !매 5분마다 수면 데이터 변경 체크 (1, 6, 11...)
        // !센서 저장과 겹치지 않게 1분 뒤 실행 & 안정화 카운트 1회당 5분으로 계산됨
        if (m % 5 === 1) {
            logger.log(`${moduleName} Sleep/Nap Data Check (5min interval)`);
            appendSleepLogRecord(ts) 
        }

      } catch (loopErr) {
        console.log("[AppService] Loop Error:", loopErr);
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