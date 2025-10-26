import * as hmUI from '@zos/ui'
import { Step } from '@zos/sensor'
import { getDeviceInfo, SCREEN_SHAPE_SQUARE } from '@zos/device'
import { log as Logger } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import * as appService from "@zos/app-service";
import { queryPermission, requestPermission } from "@zos/app";
import { replace } from "@zos/router";
import { readFileSync } from '@zos/fs'

import {
  TITLE_TEXT_STYLE,    
  ADD_BUTTON,
  SERVICE_TEXT,
  SERVICE_LABEL,
  SERVICE_BTN
} from 'zosLoader:./index.page.[pf].layout.js'

function setProperty(w, p, v) {
  w.setProperty(p, v);
}

// time_service 폴더 지정
const serviceFile = "app-service/time_service";

// 현재 파일 경로
let thisFile = "page/home/index.page";

const step = new Step()
const STEP_FILE = 'steps.json'        // /data 하위에 저장됨(앱별 샌드박스)

const txtResource = {
  label: {
    true: "Click button to stop service!",
    false: "Click button to start service!",
  },
  btn: {
    true: "Stop Service",
    false: "start Service",
  },
};

// 백그라운드 서비스 
const permissions = ["device:os.bg_service"];

const logger = Logger.getLogger('todo-list-page')

// 실행중인 서비스 목록 가져오기
let services = appService.getAllAppServices();

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
  logger.log(`=== start service: ${serviceFile} ===`);
  const result = appService.start({
    url: serviceFile,
    param: `service=${serviceFile}&action=start`,
    reload: true,
    complete_func: (info) => {
      logger.log(`startService result: ` + JSON.stringify(info));
      hmUI.showToast({ text: `start result: ${info.result}` });
      // refresh for button status

      if (info.result) {
        vm.state.running = true;
        setProperty(
          vm.state.txtLabel,
          hmUI.prop.TEXT,
          txtResource.label[vm.state.running]
        );
        setProperty(
          vm.state.serviceBtn,
          hmUI.prop.TEXT,
          txtResource.btn[vm.state.running]
        );
      }
    },
  });

  if (result) {
    logger.log("startService result: ", result);
  }
}

function stopTimeService(vm) {
  logger.log(`=== stop service: ${serviceFile} ===`);

  appService.stop({
    url: serviceFile,
    param: `service=${serviceFile}&action=stop`,
    complete_func: (info) => {
      logger.log(`stopService result: ` + JSON.stringify(info));
      hmUI.showToast({ text: `stop result: ${info.result}` });
      // refresh for button status

      if (info.result) {
        vm.state.running = false;
        setProperty(
          vm.state.txtLabel,
          hmUI.prop.TEXT,
          txtResource.label[vm.state.running]
        );
        setProperty(
          vm.state.serviceBtn,
          hmUI.prop.TEXT,
          txtResource.btn[vm.state.running]
        );
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
    },

    onInit() {
      logger.debug('page onInit invoked')                  
    },

    build() {
      logger.debug('page build invoked')      

      const vm = this;
      vm.state.running = services.includes(serviceFile);
      logger.log("service status %s", vm.state.running);      

      // Show tips
      hmUI.createWidget(hmUI.widget.TEXT, {
        ...SERVICE_TEXT,
        text: "Time report service:\nsend a notification every minute!",
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
          this.addSteps()
        }
      })
    },    
    onPause() {
      logger.log("page on pause invoke");
    },
    onResume() {
      logger.log("page on resume invoke");
      replace({ url: `${thisFile}` });
    },    
    onDestroy() {
      logger.debug('page onDestroy invoked')
    },    
  
    addSteps() {

      try {
        const ts = Date.now()
                
        const step_file = readFileSync({ path: STEP_FILE, options: { encoding: 'utf8' } })        
        
        if (!step_file) {
          hmUI.showToast({
            text: '지금은 서버에 전송할 Step 파일이 없습니다.'
          })
          console.log('[Device App.] 지금은 업데이트 할 파일이 없습니다.')
        } else {

          this.request({
            method: 'STEP_FILE',
            params: step_file
          })        
            .then(({ result }) => {          
              
              // result 안에는 JSON 객체로 날짜와 Step이 저장
              console.log(JSON.stringify(result))          
              hmUI.showToast({
                text: '성공: ' + result
              })
            })
            .catch((res) => {
              console.log('실패!!')
              hmUI.showToast({
                text: '실패: ' + result
              })
            })    
        }

      } catch (e) {
        hmUI.showToast({
          text: 'dump failed:' + e
        })
        console.error('[AppService] dump failed:', e)
      }
    },      
  })
)
