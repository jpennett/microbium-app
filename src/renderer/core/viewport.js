import { vec2 } from 'gl-matrix'
import { clampPixelRatio } from '@renderer/utils/screen'

export function createViewportController (tasks, state) {
  const { requestSync } = tasks

  const viewport = {
    toggleStats () {
      state.viewport.showStats = !state.viewport.showStats
    },

    projectScreen (screen) {
      const { center, offset, scale } = state.viewport
      vec2.sub(screen, screen, center)
      vec2.sub(screen, screen, offset)
      vec2.scale(screen, screen, 1 / scale)
      return screen
    },

    resize (event) {
      const stateViewport = state.viewport
      const { resolution, resolutionMax, size, center } = stateViewport
      const { pixelRatio } = state.controls.viewport

      const width = window.innerWidth
      const height = window.innerHeight
      vec2.set(size, width, height)
      vec2.set(center, width / 2, height / 2)

      const pixelRatioClamped = clampPixelRatio(
        size, pixelRatio, resolutionMax[0])
      const resWidth = Math.round(width * pixelRatioClamped)
      const resHeight = Math.round(height * pixelRatioClamped)
      vec2.set(resolution, resWidth, resHeight)

      stateViewport.pixelRatioClamped = pixelRatioClamped
      stateViewport.didResize = true

      tasks.run('resize', event)
    },

    wheel (event) {
      if (event.shiftKey) tasks.requestSync('seek.wheelOffset', event)
      else if (event.ctrlKey) tasks.requestSync('drag.wheelZoom', event)
      else tasks.requestSync('drag.wheelPan', event)
      event.preventDefault()
    },

    keyDown (event) {
      const { code } = event
      const stateDrag = state.drag
      const stateInput = state.input

      switch (code) {
        case 'AltLeft':
          stateInput.alt = true
          stateDrag.shouldNavigate = true
          break
        case 'ControlLeft':
          stateInput.control = true
          break
        case 'ShiftLeft':
          stateInput.shift = true
          stateDrag.shouldZoom = true
          break
      }
    },

    keyUp (event) {
      const { code } = event
      const stateDrag = state.drag
      const stateInput = state.input

      switch (code) {
        case 'AltLeft':
          stateInput.alt = false
          stateDrag.shouldNavigate = false
          break
        case 'ControlLeft':
          stateInput.control = false
          break
        case 'ShiftLeft':
          stateInput.shift = false
          stateDrag.shouldZoom = false
          break
      }
    },

    startRecording () {
      const { recording } = state
      recording.isActive = true
      recording.tick = 0
    },

    stopRecording () {
      const { recording } = state
      recording.isActive = false
    },

    updateRecordingFrame (tick) {
      const { recording } = state
      recording.tick = tick
    },

    handleCommand (data) {
      switch (data.action) {
        case 'SIMULATION_TOGGLE':
          requestSync('simulation.toggle')
          break
        case 'SIMULATION_TOGGLE_PAUSE':
          requestSync('simulation.togglePause')
          break
        case 'GEOMETRY_DELETE_LAST_VERTEX':
          requestSync('geometry.deleteLastVertex')
          break
        case 'GEOMETRY_COMPLETE_ACTIVE_SEGMENT':
          requestSync('geometry.completeActiveSegmentDiscardCursor')
          requestSync('drag.cancelDraw')
          break
        case 'GEOMETRY_DELETE_LAST_SEGMENT':
          requestSync('geometry.deleteLastSegment')
          break
        case 'VIEWPORT_TOGGLE_STATS':
          viewport.toggleStats()
          break
        case 'RECORDING_START':
          viewport.startRecording()
          break
        case 'RECORDING_STOP':
          viewport.stopRecording()
          break
        case 'RECORDING_FRAME':
          viewport.updateRecordingFrame(data.tick)
          break
      }
    },

    handleMessage (data) {
      switch (data.type) {
        case 'UPDATE_CONTROLS':
          state.controls[data.group] = data.value
          switch (data.group) {
            case 'styles':
            case 'forces':
            case 'modifiers':
            case 'viewport':
            case 'postEffects':
              state.renderer.needsUpdate = true
              break
          }
          break
        case 'MERGE_SEGMENT_PROP':
          requestSync('geometry.mergeSegmentProp',
            data.propName, data.indexFrom, data.indexTo)
          break
      }
    }
  }

  tasks.registerResponder('viewport.resize',
    viewport, viewport.resize)
  tasks.registerResponder('viewport.projectScreen',
    viewport, viewport.projectScreen)

  return viewport
}
