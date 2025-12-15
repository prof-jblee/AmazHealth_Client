import * as hmUI from '@zos/ui'
import { getDeviceInfo, SCREEN_SHAPE_SQUARE } from '@zos/device'
import { log as Logger } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import * as appService from "@zos/app-service";
import { queryPermission, requestPermission } from "@zos/app";
import { replace } from "@zos/router";
import { readFileSync, writeFileSync } from '@zos/fs'
import {
  TITLE_TEXT_STYLE,    
  ADD_BUTTON,
  SERVICE_TEXT,
  SERVICE_LABEL,
  SERVICE_BTN
} from 'zosLoader:./index.page.[pf].layout.js'

// (*) 수정: 센서 접근 권한 추가 (HeartRate, Sleep)
const permissions = [
  "device:os.bg_service",
  "data:os.sensor.heart_rate",
  "data:os.sensor.sleep"
];

let services = appService.getAllAppServices();    // 실행중인 서비스 목록 가져오기

const logger = Logger.getLogger('AmazHealth-page')

const serviceFile = "app-service/time_service";   // time_service 폴더 지정
let thisFile = "page/home/index.page";            // 현재 파일 경로

const SENSOR_FILE = 'sensor_data.json'            // 센서 데이터 파일
const SLEEP_FILE = 'sleep_data.json'              // (*) 추가: 수면 데이터 파일

const txtResource = {
  label: {
    true: "서비스를 멈추려면 버튼을 클릭하세요!",
    false: "서비스를 시작하려면 버튼을 클릭하세요!",
  },
  btn: {
    true: "서비스 정지",
    false: "서비스 시작",
  },
};

function setProperty(w, p, v) {
  w.setProperty(p, v);
}

// 백그라운드 서비스가 실행 중인지 체크하는 함수
function isServiceRunning() {           
  services = appService.getAllAppServices()
  return services.includes(serviceFile)
}

// 주기적으로 백그라운드 서비스가 실행 중인지 모니터링해주는 함수
function startServiceWatchdog(vm) {
  stopServiceWatchdog(vm) // 중복 방지
  vm.state.watchdogTimer = setInterval(() => {
    const running = isServiceRunning()
    if (!running && vm.state.shouldKeepRunning) {
      logger.log('[WATCHDOG] Service not running. restarting...')
      // 권한 체크 포함해서 재시작
      permissionRequest(vm)
    }
  }, 60000) // 60초마다 체크 (필요 시 조정)
}

// 백그라운드 서비스 모니터링 함수 종료
function stopServiceWatchdog(vm) {
  if (vm.state.watchdogTimer) {
    clearInterval(vm.state.watchdogTimer)
    vm.state.watchdogTimer = null
  }
}

function permissionRequest(vm) {
  const [result2] = queryPermission({
    permissions,
  });

  if (result2 === 0) {
    requestPermission({
      permissions,
      callback([result2]) {
        if (result2 === 2) {
          startTimeService(vm);
        }
      },
    });
  } else if (result2 === 2) {
    startTimeService(vm);
  }
}

function startTimeService(vm) {
  logger.log(`=== Start Service: ${serviceFile} ===`);

  vm.state.shouldKeepRunning = true      // 실행 유지

  const result = appService.start({
    url: serviceFile,
    param: `service=${serviceFile}&action=start`,
    reload: true,
    complete_func: (info) => {
      logger.log(`StartService result: ` + JSON.stringify(info));
      hmUI.showToast({ text: `Start result: ${info.result}` });
      
      // refresh for button status
      if (info.result) {
        vm.state.running = true;
        setProperty(vm.state.txtLabel, hmUI.prop.TEXT, txtResource.label[vm.state.running]);
        setProperty(vm.state.serviceBtn, hmUI.prop.TEXT, txtResource.btn[vm.state.running]);
      }
    },
  });

  if (result) {
    logger.log("StartService Result: ", result);
  }
}

function stopTimeService(vm) {
  logger.log(`=== Stop service: ${serviceFile} ===`);

  vm.state.shouldKeepRunning = false     // 중지 유지
  stopServiceWatchdog(vm)                // 감시 중단

  appService.stop({
    url: serviceFile,
    param: `service=${serviceFile}&action=stop`,
    complete_func: (info) => {
      logger.log(`StopService result: ` + JSON.stringify(info));
      hmUI.showToast({ text: `Stop result: ${info.result}` });
      // refresh for button status

      if (info.result) {
        vm.state.running = false;
        setProperty(vm.state.txtLabel, hmUI.prop.TEXT, txtResource.label[vm.state.running]);
        setProperty(vm.state.serviceBtn, hmUI.prop.TEXT, txtResource.btn[vm.state.running]);
      }
    },
  });  
}

Page(
  BasePage({
    
    // 상태 관리 변수 선언
    state: {      
      running: false,
      txtLabel: null,
      serviceBtn: null,
      watchdogTimer: null,      // setInterval 핸들
      shouldKeepRunning: false, // 자동 재시작 여부
    },

    onInit() {
      logger.debug('Page onInit invoked')                  
    },

    build() {
      logger.debug('Page build invoked')      

      const vm = this;
      vm.state.running = isServiceRunning()             // 상태 반영
      vm.state.shouldKeepRunning = vm.state.running     // 이미 돌고 있으면 유지
      if (vm.state.running) startServiceWatchdog(vm)    // 초기 진입 시 감시 시작

      logger.log("Service status %s", vm.state.running);      

      // Show tips
      hmUI.createWidget(hmUI.widget.TEXT, {
        ...SERVICE_TEXT,
        text: "센서 및 수면 데이터 수집",
      });

      vm.state.txtLabel = hmUI.createWidget(hmUI.widget.TEXT, {
        ...SERVICE_LABEL,
        text: txtResource.label[vm.state.running],
      });

      vm.state.serviceBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
        ...SERVICE_BTN,
        text: txtResource.btn[vm.state.running],
        click_func: function () {
          if (vm.state.running) stopTimeService(vm);
          else permissionRequest(vm);
        },
      });

      if (getDeviceInfo().screenShape !== SCREEN_SHAPE_SQUARE) {
        this.state.title = hmUI.createWidget(hmUI.widget.TEXT, {
          ...TITLE_TEXT_STYLE
        })
      }

      // 서버 전송 버튼
      this.state.addButton = hmUI.createWidget(hmUI.widget.BUTTON, {
        ...ADD_BUTTON,
        click_func: () => {
          this.RequestServer()
        }
      })
    },    
    onPause() {
      logger.log("Page on pause invoke");
    },
    onResume() {
      logger.log("Page on resume invoke");

      // 상태 재동기화
      this.state.running = isServiceRunning()
      // 사용자의 의도가 실행 유지라면 감시 재가동
      if (this.state.shouldKeepRunning) startServiceWatchdog(this)

      replace({ url: `${thisFile}` });
    },    
    onDestroy() {
      logger.debug('Page onDestroy invoked')
    },    
  
    // App-side로 저장된 파일 내용을 보내서 서버에 Request 하기
    RequestServer() {

      try {
        // (*) 1. 센서 데이터 읽기
        let sensorList = []
        try {
          const sensorText = readFileSync({ path: SENSOR_FILE, options: { encoding: 'utf8' } })
          if (sensorText) sensorList = JSON.parse(sensorText)
        } catch (e) {
          console.log('센서 데이터 파일 없음 또는 읽기 실패')
        }

        // (*) 2. 수면 데이터 읽기
        let sleepList = []
        try {
          const sleepText = readFileSync({ path: SLEEP_FILE, options: { encoding: 'utf8' } })
          if (sleepText) sleepList = JSON.parse(sleepText)
        } catch (e) {
          console.log('수면 데이터 파일 없음 또는 읽기 실패')
        }
        
        // 데이터가 둘 다 없으면 중단
        if (sensorList.length === 0 && sleepList.length === 0) {
          hmUI.showToast({
            text: '전송할 데이터가 없습니다.'
          })
          console.log('[Device App.] 전송할 데이터가 없습니다.')
          return
        }

        // (*) 3. 두 리스트를 합침 (센서 + 수면)
        const finalData = sensorList.concat(sleepList)

        this.request({
          method: 'SEND_DATA',
          params: JSON.stringify(finalData) // (*) 합친 배열을 문자열로 전송
        })        
          .then(({ result }) => {                        
            console.log('전송 결과: ' + JSON.stringify(result))          
            
            hmUI.showToast({
              text: '전송 성공'
            })

            // (*) 4. 전송 성공 시, 센서/수면 파일 모두 비우기 (초기화)
            // 빈 배열 '[]'을 문자열로 저장
            writeFileSync({
              path: SENSOR_FILE,
              data: JSON.stringify([]), 
              options: { encoding: 'utf8' }
            })
            
            writeFileSync({
              path: SLEEP_FILE,
              data: JSON.stringify([]),
              options: { encoding: 'utf8' }
            })
            
            console.log('[Device App.] 파일 데이터 초기화 완료')
          })
          .catch((res) => {
            console.log('전송 실패!!', res)
            hmUI.showToast({
              text: '전송 실패'
            })
          })    

      } catch (e) {
        hmUI.showToast({
          text: '데이터 처리 오류:' + e
        })
        console.error('[Device App.] 데이터 처리 오류:', e)
      }
    },      
  })
)