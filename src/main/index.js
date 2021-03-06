'use strict'

import {
  app,
  ipcMain,
  dialog,
  screen,
  shell,
  BrowserWindow,
  Menu
} from 'electron'
import Store from 'electron-store'
import log from 'electron-log'
import createVideoRecorder from '@microbium/electron-recorder'

import {
  readFile,
  writeFile,
  rename as renameFile
} from 'fs-extra'
import {
  basename,
  dirname,
  join as pathJoin
} from 'path'
import {
  deflateSync,
  inflateSync
} from 'zlib'

import { isHighSierra } from './utils/platform'
import { fitRect } from './utils/window'
import { createMessageSocket } from './io/socket'
import { createMenuTemplate } from './ui/menu'
import { createPaletteTouchBar, createEditorTouchBar } from './ui/touchbar'
import { exportSceneHTML } from './exporters/html'
import { createControlsState } from '@renderer/store/modules/Palette'

const IS_DEV = process.env.NODE_ENV === 'development'
const LOG_LEVEL_FILE = 'warn'
const ENABLE_IPC_EXTERNAL = false
const DEBUG_MAIN = false
const DEBUG_PALETTE = false

// Disable security warnings for now
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true

/**
 * Set `__static` path to static files in production
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-static-assets.html
 */
if (!IS_DEV) {
  global.__static = pathJoin(__dirname, '/static').replace(/\\/g, '\\\\')
} else {
  global.__static = __static
}

log.transports.file.level = LOG_LEVEL_FILE

const ipcExternal = ENABLE_IPC_EXTERNAL
  ? createMessageSocket(41234, 'localhost')
  : null

const appMenus = {
  main: null
}
const appTouchBars = {
  main: null,
  palette: null
}
const appWindows = {
  main: null,
  palette: null
}
const paletteVisibility = {
  isHidden: false,
  isHiddenUser: false
}
const paletteState = createControlsState()
const editorState = {
  isEdited: false,
  isSimRunning: false,
  isSimPaused: false
}

const mainURL = IS_DEV
  ? 'http://localhost:9080'
  : `file://${__dirname}/index.html`
const paletteURL = IS_DEV
  ? 'http://localhost:9080/#/palette'
  : `file://${__dirname}/index.html#/palette`

const store = new Store()
let appIsReady = false
let appShouldQuit = false

// TODO: Cleanup actions
const appActions = createAppActions()
function createAppActions () {
  // TODO: Cleanup file filters
  const fileTypeFilters = [{
    name: 'Microbium Scene',
    extensions: ['mcrbm']
  }]
  const imageTypeFilters = [{
    name: 'Images',
    extensions: ['png']
  }]
  const jsonTypeFilters = [{
    name: 'JSON',
    extensions: ['json']
  }]
  const htmlTypeFilters = [{
    name: 'HTML',
    extensions: ['html']
  }]
  const videoTypeFilters = [{
    name: 'Videos',
    extensions: ['mov']
  }]

  return {
    createNewScene () {
      store.set('openScenePath', null)
      resetControls()
      createMainWindow()
    },

    openScene () {
      dialog.showOpenDialog(null, {
        openDirectory: false,
        multiSelections: false,
        filters: fileTypeFilters
      }).then(({ filePaths }) => {
        if (!(filePaths && filePaths.length)) return
        const filePath = filePaths[0]
        store.set('openScenePath', filePath)
        app.addRecentDocument(filePath)
        openSceneFile(filePath)
      })
    },

    saveScene (useOpenScene) {
      const openScenePath = store.get('openScenePath')
      if (useOpenScene && openScenePath) {
        saveSceneFile(openScenePath)
        return
      }
      dialog.showSaveDialog(null, {
        filters: fileTypeFilters
      }).then(({ filePath }) => {
        if (!filePath) return
        store.set('openScenePath', filePath)
        app.addRecentDocument(filePath)
        saveSceneFile(filePath)
      })
    },

    revertScene () {
      const fileName = store.get('openScenePath')
      if (!fileName) return
      if (store.get('dontAskRevertScene')) {
        openSceneFile(fileName)
        return
      }
      dialog.showMessageBox(appWindows.main, {
        type: 'question',
        buttons: ['OK', 'Cancel'],
        defaultId: 1,
        message: 'Revert to saved version of scene?',
        detail: 'This will revert your current changes and cannot be undone.',
        checkboxLabel: "Don't ask me again",
        checkboxChecked: false
      }).then(({ response, checkboxChecked }) => {
        if (response === 0) {
          openSceneFile(fileName)
          if (checkboxChecked) store.set('dontAskRevertScene', true)
        }
      })
    },

    importControllers () {
      dialog.showOpenDialog(null, {
        openDirectory: false,
        multiSelections: false,
        filters: fileTypeFilters
      }).then(({ filePaths }) => {
        if (!(filePaths && filePaths.length)) return
        const filePath = filePaths[0]
        importSceneFileControllers(filePath)
      })
    },

    saveFrameImage () {
      dialog.showSaveDialog(null, {
        filters: imageTypeFilters
      }).then(({ filePath }) => {
        if (!filePath) return
        saveFrameImageFromCanvas(filePath)
      })
    },

    exportJSON () {
      dialog.showSaveDialog(null, {
        filters: jsonTypeFilters
      }).then(({ filePath }) => {
        if (!filePath) return
        exportSceneFile(filePath)
      })
    },

    exportHTML () {
      dialog.showSaveDialog(null, {
        filters: htmlTypeFilters
      }).then(({ filePath }) => {
        if (!filePath) return
        requestWindowResponse('main', 'serialize-scene', { path: filePath })
          .then((data) => exportSceneHTML(filePath, data))
      })
    },

    toggleSimulation () {
      if (appWindows.main && appWindows.main.isFocused()) {
        toggleSimulationState()
        // FIXME: Inconsistent key input capturing after toggling menu item state
        // toggleMenuItem('simulation')
      }
    },

    toggleSimulationFromTouchbar () {
      if (appWindows.main) {
        toggleSimulationState()
      }
    },

    toggleSimulationPause () {
      toggleSimulationPauseState()
    },

    toggleMainToolbar () {
      if (appWindows.main) {
        sendWindowMessage('main', 'command',
          { action: 'EDITOR_TOGGLE_TOOLBAR' })
        toggleMenuItem('toolbar')
      }
    },

    toggleStatus () {
      if (appWindows.main && appWindows.main.isFocused()) {
        sendWindowMessage('main', 'command',
          { action: 'VIEWPORT_TOGGLE_STATS' })
        toggleMenuItem('status')
      }
    },

    deleteLastSegment () {
      if (appWindows.main && appWindows.main.isFocused()) {
        sendWindowMessage('main', 'command',
          { action: 'GEOMETRY_DELETE_LAST_SEGMENT' })
      }
    },

    deleteLastVertex () {
      if (appWindows.main && appWindows.main.isFocused()) {
        sendWindowMessage('main', 'command',
          { action: 'GEOMETRY_DELETE_LAST_VERTEX' })
      }
    },

    completeSegment () {
      if (appWindows.main && appWindows.main.isFocused()) {
        sendWindowMessage('main', 'command',
          { action: 'GEOMETRY_COMPLETE_ACTIVE_SEGMENT' })
      }
    },

    setStrokeWidth (value) {
      sendWindowMessage('palette', 'command',
        { action: 'SET_STROKE_WIDTH', value })
    },

    setStrokeColor (value) {
      sendWindowMessage('palette', 'command',
        { action: 'SET_STROKE_COLOR', value })
    },

    setInputModType (value) {
      sendWindowMessage('palette', 'command',
        { action: 'SET_INPUT_MOD_TYPE', value })
    },

    selectStyleLayer (index) {
      sendWindowMessage('palette', 'command',
        { action: 'SELECT_STYLE_LAYER', index })
    },

    selectNextStyleLayer (dir) {
      sendWindowMessage('palette', 'command',
        { action: 'SELECT_NEXT_STYLE_LAYER', dir })
    },

    selectConstraintGroup (index) {
      sendWindowMessage('palette', 'command',
        { action: 'SELECT_CONSTRAINT_GROUP', index })
    },

    selectNextConstraintGroup (dir) {
      sendWindowMessage('palette', 'command',
        { action: 'SELECT_NEXT_CONSTRAINT_GROUP', dir })
    },

    togglePalette () {
      paletteVisibility.isHiddenUser = !paletteVisibility.isHiddenUser
      toggleWindow('palette')
      toggleMenuItem('palette')
    },

    setActivePalette (id) {
      syncActivePalette(id)
      sendWindowMessage('palette', 'command',
        { action: 'SET_ACTIVE_PALETTE', id })
    },

    setPaletteLayout (id) {
      store.set('window.palette.layout', { id })
      syncPaletteLayoutView(id)
      syncPaletteLayoutStyles(id)
    },

    setAspectRatio (aspectName) {
      setWindowAspectRatio('main', aspectName)
    },

    viewSource () {
      shell.openExternal('https://github.com/microbium/microbium-app')
    },

    reportIssue () {
      shell.openExternal('https://github.com/microbium/microbium-app/issues')
    },

    sendFeedback () {
      shell.openExternal('mailto:jay.patrick.weeks@gmail.com')
    },

    startScreenRecording () {
      setMenuState('start-screen-recording', 'enabled', false)
      setMenuState('stop-screen-recording', 'enabled', true)
      startWindowScreenRecording('main')
    },

    stopScreenRecording () {
      setMenuState('start-screen-recording', 'enabled', true)
      setMenuState('stop-screen-recording', 'enabled', false)
      stopWindowScreenRecording('main')
        .then((recording) => {
          dialog.showSaveDialog(null, {
            filters: videoTypeFilters
          }).then(({ filePath }) => {
            if (!filePath) return
            saveScreenRecording(recording, filePath)
          })
        })
    }
  }
}

// ------------------------------------------------------------
// Application Menu
// ----------------

function createMenu () {
  if (appMenus.main !== null) return

  const template = createMenuTemplate(app, appActions)
  const menu = appMenus.main = Menu.buildFromTemplate(template)

  ipcMain.on('main+menu-message', onMenuMessage)
  ipcMain.on('menu-message', onMenuMessage)
  Menu.setApplicationMenu(menu)
}

// ------------------------------------------------------------
// Main TouchBar
// -------------

function createTouchBar () {
  appTouchBars.palette = createPaletteTouchBar(appActions)
  appTouchBars.editor = createEditorTouchBar(appActions)
}

// ------------------------------------------------------------
// Main Window
// -----------

function createMainWindow () {
  if (appWindows.main !== null) return
  const displaySize = getDisplaySize()

  const transform = fitRect(displaySize, {
    padding: 60,
    aspect: displaySize.width / displaySize.height,
    alignX: 0.5,
    alignY: 0.5
  })

  const main = appWindows.main = new BrowserWindow({
    // titleBarStyle: 'hiddenInset',
    frame: false,
    backgroundColor: '#222222',
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    show: true,
    webPreferences: {
      devTools: DEBUG_MAIN,
      nodeIntegration: true,
      webSecurity: !IS_DEV
    }
  })

  // TODO: Should probably save state in main process
  // then sync to windows .. this is fine for now
  const onMainMessage = (event, data) => {
    if (data.type === 'UPDATE_CONTROLS') {
      setMainEdited(true)
    }
    sendWindowMessage('main', 'message', data)
  }

  setMenuState('create-scene', 'enabled', false)
  setMenuState('revert-scene', 'enabled', true)
  setMenuState('import-controllers', 'enabled', true)

  restoreWindowPosition('main')
  restoreWindowAspect('main')

  editorState.isEdited = false
  editorState.isSimRunning = false
  editorState.isSimPaused = false

  main.setTouchBar(appTouchBars.editor)
  main.loadURL(mainURL)
  onWindowFocus()

  main.on('focus', onWindowFocus)
  main.on('blur', onWindowBlur)
  ipcMain.on('main-message', onMainMessage)
  ipcMain.on('main+menu-message', onMainMessage)

  main.on('close', (event) => {
    storeWindowPosition('main')
    storeWindowPosition('palette')
    if (!IS_DEV && !confirmShouldCloseWindow(main)) {
      event.preventDefault()
    }
  })

  main.on('closed', () => {
    ipcMain.removeListener('main-message', onMainMessage)
    ipcMain.removeListener('main+menu-message', onMainMessage)
    setMenuState('create-scene', 'enabled', true)
    setMenuState('revert-scene', 'enabled', false)
    setMenuState('import-controllers', 'enabled', false)
    appWindows.main = null
  })
}

// ------------------------------------------------------------
// Palette Window
// --------------

function createPaletteWindow () {
  if (appWindows.palette !== null) return

  const displaySize = getDisplaySize()
  const windowSize = {
    width: 320,
    height: Math.min(800,
      Math.round(displaySize.height * (2 / 3)))
  }

  const palette = appWindows.palette = new BrowserWindow({
    x: 20,
    y: Math.round((displaySize.height - windowSize.height) / 3),
    width: windowSize.width,
    minWidth: 320,
    maxWidth: 420,
    height: windowSize.height,
    minHeight: 500,
    backgroundColor: IS_DEV ? '#222222' : null, // FIXME: Issue with reload in dev
    frame: false,
    focusable: true,
    resizable: true,
    closable: true, // FIXME: Setting false prevents app quit ...
    minimizable: false,
    maximizable: false,
    fullscreen: false,
    fullscreenable: true,
    hasShadow: true,
    // TODO: Use system light / dark, design light theme
    vibrancy: 'ultra-dark',
    transparent: isHighSierra(),
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      // TODO: Would be nice to have native-feeling bounce ...
      scrollBounce: false,
      nodeIntegration: true,
      devTools: DEBUG_PALETTE
    }
  })

  const onPaletteMessage = (event, data) => {
    sendWindowMessage('palette', 'message', data)
  }

  restorePaletteLayoutView()
  restoreWindowPosition('palette')

  palette.setTouchBar(appTouchBars.palette)
  palette.loadURL(paletteURL)
  palette.on('blur', onWindowBlur)

  palette.once('ready-to-show', () => {
    if (DEBUG_PALETTE) {
      palette.webContents.openDevTools({ mode: 'detach' })
    }
    palette.showInactive()
    ipcMain.on('palette+menu-message', onMenuMessage)
    ipcMain.on('palette+menu-message', onPaletteMessage)
    ipcMain.on('palette-message', onPaletteMessage)
  })

  palette.on('close', (event) => {
    if (appShouldQuit) return
    event.preventDefault()
    paletteVisibility.isHiddenUser = !paletteVisibility.isHiddenUser
    toggleWindow('palette')
    toggleMenuItem('palette')
  })
  palette.on('closed', () => {
    appWindows.palette = null
  })
}

// ------------------------------------------------------------
// Window Management
// -----------------

function onWindowFocus () {
  if (DEBUG_PALETTE) return
  if (paletteVisibility.isHidden &&
    !paletteVisibility.isHiddenUser &&
    appWindows.palette) {
    appWindows.palette.showInactive()
    paletteVisibility.isHidden = false
  }
}
function onWindowBlur () {
  if (DEBUG_PALETTE) return
  const shouldHide = !BrowserWindow.getFocusedWindow() &&
    paletteState.layoutMode.id === 'narrow'
  if (appWindows.palette && shouldHide) {
    appWindows.palette.hide()
    paletteVisibility.isHidden = true
  }
}

function getDisplaySize () {
  return screen.getPrimaryDisplay().workAreaSize
}

function createStartWindows () {
  createMenu()
  createTouchBar()
  createPaletteWindow()
  createMainWindow()
  restoreLastSession()
}

function toggleWindow (name) {
  const win = appWindows[name]
  if (!win) return

  if (win.isVisible()) win.hide()
  else win.showInactive()
}

function closeWindow (name) {
  const win = appWindows[name]
  if (!win) return

  win.close()
}

function storeWindowPosition (name) {
  const win = appWindows[name]
  if (!win) return

  const position = win.getPosition()
  const size = win.getSize()

  store.set(`window.${name}.position`, {
    x: position[0],
    y: position[1],
    width: size[0],
    height: size[1]
  })
}

function restoreWindowPosition (name) {
  const win = appWindows[name]
  if (!win) return

  const state = store.get(`window.${name}.position`)
  if (!state) return

  const { x, y, width, height } = state
  win.setPosition(x, y)
  win.setSize(width, height)
}

function setWindowFilePath (name, fullPath) {
  const win = appWindows[name]
  if (!win) return
  const fileName = basename(fullPath)
  sendWindowMessage('main', 'message', {
    type: 'UPDATE_FILE_PATH',
    fullPath,
    fileName
  })
  win.setTitle(fileName)
  win.setRepresentedFilename(fullPath)
}

function getAspect (aspectName) {
  const [aw, ah] = aspectName.split(':')
  return ah === 0 ? 0 : (aw / ah)
}

// TODO: Ensure resized window fits within screen
function setWindowAspectRatio (name, aspectName) {
  const win = appWindows[name]
  if (!win) return

  const aspect = getAspect(aspectName)
  store.set(`window.${name}.aspect`, aspectName)

  if (aspectName === '0:0') {
    win.setAspectRatio(0)
    return
  }

  const size = win.getSize()
  const targetWidth = Math.round(size[1] * aspect)
  const targetHeight = size[1]

  win.setSize(targetWidth, targetHeight)
  win.setAspectRatio(aspect)
}

function restoreWindowAspect (name) {
  const win = appWindows[name]
  if (!win) return

  const aspectName = store.get(`window.${name}.aspect`) || '0:0'
  const aspect = getAspect(aspectName)

  win.setAspectRatio(aspect)
  setMenuState(`aspect-ratio-${aspectName}`, 'checked', true)
}

function setMainEdited (isEdited) {
  const { main } = appWindows
  editorState.isEdited = isEdited
  if (main) {
    main.setDocumentEdited(isEdited)
    main.send('message', { type: 'SET_EDITED', isEdited })
  }
}

function sendWindowMessage (name, messageKey, messageData) {
  const win = appWindows[name]
  if (!win) return
  win.send(messageKey, messageData)
  return win
}

function requestWindowResponse (name, messageKey, messageData) {
  const win = sendWindowMessage(name, messageKey, messageData)
  if (!win) {
    return Promise.reject(
      new Error(`window ${name} does not exist`))
  }
  return new Promise((resolve, reject) => {
    ipcMain.once(`${messageKey}--response`, (event, data) => {
      resolve(data)
    })
  })
}

// TODO: Track if changes have been made to geometry since last save
// TODO: Prompt to save changes
// Currently just tracking controls changes
function confirmShouldCloseWindow (win) {
  if (!editorState.isEdited) return true
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['Close', 'Cancel'],
    defaultId: 1,
    message: 'Lose unsaved changes?'
  })
  return choice === 0
}

// ------------------------------------------------------------
// Scene Persistence
// -----------------

function openSceneFile (path) {
  createMainWindow()
  readFile(path, null)
    .then((buf) => inflateSync(buf))
    .then((buf) => buf.toString('utf8'))
    .then((data) => {
      setMenuState('revert-scene', 'enabled', true)
      setMenuState('import-controllers', 'enabled', true)
      setMenuState('simulation-toggle', 'checked', false)
      setWindowFilePath('main', path)
      setMainEdited(false)
      sendWindowMessage('main', 'deserialize-scene', { path, data })
    })
    .catch((err) => {
      log.error(err)
    })
}

function saveSceneFile (path) {
  requestWindowResponse('main', 'serialize-scene', { path })
    .then((data) => JSON.stringify(data))
    .then((str) => deflateSync(str))
    .then((buf) => writeFile(path, buf))
    .then(() => {
      setWindowFilePath('main', path)
      setMainEdited(false)
      console.log(`Saved scene to ${path}.`)
    })
    .catch((err) => {
      log.error(err)
    })
}

function exportSceneFile (path) {
  requestWindowResponse('main', 'serialize-scene', { path })
    .then((data) => JSON.stringify(data))
    .then((buf) => writeFile(path, buf))
    .then(() => {
      console.log(`Exported scene to ${path}.`)
    })
    .catch((err) => {
      log.error(err)
    })
}

function restoreLastSession () {
  ipcMain.on('main-will-start', () => {
    const openScenePath = store.get('openScenePath')
    if (!openScenePath) return
    openSceneFile(openScenePath)
  })
}

function importSceneFileControllers (path) {
  readFile(path, null)
    .then((buf) => inflateSync(buf))
    .then((buf) => buf.toString('utf8'))
    .then((data) => {
      sendWindowMessage('main', 'deserialize-scene-controllers', { path, data })
    })
    .catch((err) => {
      log.error(err)
    })
}

// ------------------------------------------------------------
// Screen Recording
// ----------------

const activeRecordings = {}
function startWindowScreenRecording (name) {
  const win = appWindows[name]
  if (!win || activeRecordings[name]) {
    return Promise.reject(
      new Error(`window ${name} does not exist or recording has started`))
  }

  const output = pathJoin(dirname(store.path), 'temp-output.mov')
  const video = createVideoRecorder(win, {
    fps: 24,
    crf: 18,
    output
  })
  const recording = activeRecordings[name] = {
    isRecording: true,
    output,
    video
  }

  let tick = 0
  const frame = () => {
    if (!recording.isRecording) return
    tick++
    sendWindowMessage(name, 'command',
      { action: 'RECORDING_FRAME', tick })
    video.frame(frame)
  }

  process.nextTick(frame)
  sendWindowMessage(name, 'command',
    { action: 'RECORDING_START' })

  return Promise.resolve(recording)
}

function stopWindowScreenRecording (name) {
  const win = appWindows[name]
  const recording = activeRecordings[name]
  if (!(win && recording)) {
    return Promise.reject(
      new Error(`window ${name} does not exist or recording has not started`))
  }

  recording.isRecording = false
  activeRecordings[name] = null
  sendWindowMessage(name, 'command',
    { action: 'RECORDING_STOP' })

  return new Promise((resolve) => {
    recording.video.end(() => {
      resolve(recording)
    })
  })
}

function saveScreenRecording (recording, fileName) {
  renameFile(recording.output, fileName)
}

// ------------------------------------------------------------
// Canvas Image Exporting
// ----------------------

function saveFrameImageFromCanvas (path) {
  requestWindowResponse('main', 'save-frame', { path })
    .then(() => {
      console.log(`Saved frame image to ${path}.`)
    })
    .catch((err) => {
      log.error(err)
    })
}

// ------------------------------------------------------------
// Menu State
// ----------

function onMenuMessage (event, data) {
  switch (data.type) {
    case 'UPDATE_CONTROLS':
      syncControls(data)
      break
    case 'UPDATE_ACTIVE_PALETTE':
      syncActivePalette(data.id)
      break
  }
}

function initControls () {
  syncStrokeControls()
  syncStyleLayers()
  syncConstraintGroups()
}

function resetControls () {
  Object.assign(paletteState, createControlsState())
  syncStrokeControls()
  syncStyleLayers()
  syncConstraintGroups()
  sendWindowMessage('palette', 'message',
    { type: 'RESET_CONTROLS' })
}

function syncControls ({ group, key, value }) {
  if (group === null) {
    const { lineTool, styles, constraintGroups } = value
    Object.assign(paletteState, {
      lineTool,
      styles,
      constraintGroups
    })
    syncStrokeControls()
    syncStyleLayers()
    syncConstraintGroups()
  }

  if (group === 'lineTool') {
    Object.assign(paletteState.lineTool, value)
    syncStrokeControls()
    syncStyleLayers()
    syncConstraintGroups()
  }

  if (group === 'styles') {
    paletteState.styles = value
    syncStyleLayers()
  }

  if (group === 'constraintGroups') {
    paletteState.constraintGroups = value
    syncConstraintGroups()
  }
}

function syncStrokeControls () {
  const { lineTool } = paletteState
  appTouchBars.editor.syncStroke(lineTool)
}

function syncStyleLayers () {
  const { styles, lineTool } = paletteState
  const { styleIndex } = lineTool
  setMenuState('prev-style-layer', 'enabled', styleIndex > 0)
  setMenuState('next-style-layer', 'enabled', styleIndex < styles.length - 1)
  appTouchBars.editor.syncStyles(styles, styleIndex)
}

function syncConstraintGroups () {
  const { constraintGroups, lineTool } = paletteState
  const { constraintIndex } = lineTool
  setMenuState('prev-constraint-group', 'enabled', constraintIndex > 0)
  setMenuState('next-constraint-group', 'enabled', constraintIndex < constraintGroups.length - 1)
  appTouchBars.editor.syncConstraintGroups(constraintGroups, constraintIndex)
}

function syncActivePalette (id) {
  if (paletteState.activePalettes.id === id) return
  paletteState.activePalettes.id = id

  setMenuState(`palette-${id}`, 'checked', true)
  appTouchBars.palette.syncActivePalette(id)
}

function syncPaletteLayoutView (id) {
  const { palette } = appWindows
  if (!palette) return

  const displaySize = getDisplaySize()
  const size = palette.getSize()
  paletteState.layoutMode.id = id

  switch (id) {
    case 'narrow':
      palette.setMinimumSize(320, 500)
      palette.setMaximumSize(420, 1200)
      palette.setSize(420, size[1])
      palette.setAlwaysOnTop(true)
      break
    case 'wide':
      palette.setMinimumSize(960, 500)
      palette.setMaximumSize(420 * 4, 1200)
      palette.setSize(Math.round(displaySize.width * 0.9), size[1])
      palette.setAlwaysOnTop(false)
      break
  }
}

function syncPaletteLayoutStyles (id) {
  sendWindowMessage('palette', 'command',
    { action: 'SET_LAYOUT', id })
}

function restorePaletteLayoutView () {
  const state = store.get('window.palette.layout')
  if (!state) return
  syncPaletteLayoutView(state.id)
}

function setMenuState (name, key, value) {
  const item = appMenus.main.getMenuItemById(name)
  if (!item) {
    throw new Error(`Menu item ${name} does not exist`)
  }
  item[key] = value
}

function toggleMenuItem (name) {
  const menu = appMenus.main

  const menuItemOn = menu.getMenuItemById(name + '-on')
  const menuItemOff = menu.getMenuItemById(name + '-off')

  if (!menuItemOn.enabled) {
    menuItemOn.visible = menuItemOn.enabled = true
    menuItemOff.visible = menuItemOff.enabled = false
  } else {
    menuItemOn.visible = menuItemOn.enabled = false
    menuItemOff.visible = menuItemOff.enabled = true
  }
}

// TODO: Sync simulation state on window reload
function toggleSimulationState () {
  editorState.isSimRunning = !editorState.isSimRunning
  syncSimulationState()
}

function syncSimulationState () {
  const isRunning = editorState.isSimRunning
  const message = { action: 'SIMULATION_TOGGLE', isRunning }

  appTouchBars.palette.syncSimulationRunningState(isRunning)
  appTouchBars.editor.syncSimulationRunningState(isRunning)
  sendWindowMessage('main', 'command', message)
  sendWindowMessage('palette', 'command', message)
}

function toggleSimulationPauseState () {
  const isPaused = editorState.isSimPaused = !editorState.isSimPaused
  const message = { action: 'SIMULATION_TOGGLE_PAUSE', isPaused }

  appTouchBars.palette.syncSimulationPausedState(isPaused)
  appTouchBars.editor.syncSimulationPausedState(isPaused)
  sendWindowMessage('main', 'command', message)
  sendWindowMessage('palette', 'command', message)
}

// ------------------------------------------------------------

ipcMain.on('external-message', (event, data) => {
  if (!ENABLE_IPC_EXTERNAL) return
  ipcExternal.send(data)
})

ipcMain.on('toggle-window', (event, data) => {
  toggleWindow('palette')
  toggleMenuItem('palette')
})

ipcMain.on('close-window', (event, data) => {
  closeWindow(data.name)
})

app.on('open-file', (event, fileName) => {
  log.info('open-file', fileName)
  store.set('openScenePath', fileName)
  if (!appIsReady) return
  if (!appWindows.main) createMainWindow()
  else openSceneFile(fileName)
})
app.on('before-quit', () => {
  appShouldQuit = true
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('ready', () => {
  appIsReady = true
  createStartWindows()
  initControls()
})
app.on('activate', createStartWindows)

app.commandLine.appendSwitch('--ignore-gpu-blacklist')

/**
 * Auto Updater
 *
 * Uncomment the following code below and install `electron-updater` to
 * support auto updating. Code Signing with a valid certificate is required.
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-electron-builder.html#auto-updating
 */

/*
import { autoUpdater } from 'electron-updater'

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall()
})

app.on('ready', () => {
  if (process.env.NODE_ENV === 'production') autoUpdater.checkForUpdates()
})
 */
