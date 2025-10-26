import * as hmUI from '@zos/ui'
import { getText } from '@zos/i18n'
import { getDeviceInfo } from '@zos/device'
import { px } from '@zos/utils'

export const { width: DEVICE_WIDTH, height: DEVICE_HEIGHT } = getDeviceInfo()

export const TITLE_TEXT_STYLE = {
  text: getText('todoList'),
  x: px(42),
  y: px(65),
  w: DEVICE_WIDTH - px(42 * 2),
  h: px(50),
  color: 0xffffff,
  text_size: 36,
  align_h: hmUI.align.CENTER_H,
  text_style: hmUI.text_style.WRAP
}

export const TODAY_TEXT = {
  text: 'Today: ',
  x: px(42),
  y: px(65),
  w: DEVICE_WIDTH - px(42 * 2),
  h: px(50),
  color: 0xffffff,
  text_size: 22,
  align_h: hmUI.align.LEFT,
  text_style: hmUI.text_style.NONE
}

export const ADD_BUTTON = {
  x: Math.floor((DEVICE_WIDTH - px(88)) / 2),
  y: DEVICE_HEIGHT - px(100),
  w: px(88),
  h: px(88),
  normal_src: 'add.png',
  press_src: 'add.png'
}

export const SERVICE_TEXT = {
  x: px(40),
  y: px(100),
  w: DEVICE_WIDTH - px(40) * 2,
  h: px(80),
  text_size: px(20),
  align_h: hmUI.align.CENTER_H,
  color: 0xffffff,
};
export const SERVICE_LABEL = {
  x: px(40),
  y: px(180),
  w: DEVICE_WIDTH - px(40) * 2,
  h: px(120),
  text_size: px(24),
  align_h: hmUI.align.CENTER_H,
  color: 0xffffff,
};
export const SERVICE_BTN = {
  x: px(100),
  y: px(280),
  w: DEVICE_WIDTH - px(100) * 2,
  h: px(50),
  radius: 8,
  press_color: 0x1976d2,
  normal_color: 0xef5350,
};