import { vec2, vec3, mat4 } from 'gl-matrix'
import { radialPosition } from '@renderer/utils/math'

// TODO: Improve transition between ortho / perspective projection
const ENABLE_PERSPECTIVE_VIEW = true

export function createCameras (tasks, state, renderer) {
  const { regl } = renderer

  const scratchVec3A = vec3.create()
  const scratchVec3B = vec3.create()

  const baseUniforms = {
    viewResolution: regl.prop('viewResolution'),
    viewOffset: regl.prop('viewOffset'),
    viewScale: regl.prop('viewScale')
  }

  const sceneOrtho = (() => {
    const view = mat4.create()
    const projection = mat4.create()

    const setup = regl({
      uniforms: {
        ...baseUniforms,
        view: (params, context) => {
          const { viewOffset, viewScale } = context
          const offset3 = vec3.set(scratchVec3A, viewOffset[0], viewOffset[1], 0)
          const scale3 = vec3.set(scratchVec3B, viewScale, viewScale, viewScale)
          mat4.fromTranslation(view, offset3)
          mat4.scale(view, view, scale3)
          return view
        },
        projection: () => projection
      }
    })

    const resize = (event, size) => {
      const w = size[0] / 4
      const h = size[1] / 4
      mat4.ortho(projection, -w, w, h, -h, 0, 2000)
    }

    return {
      view,
      projection,
      lineScaleFactor: 1,
      shouldAdjustThickness: true,
      setup,
      resize
    }
  })()

  const scenePerspective = (() => {
    const view = mat4.create()
    const projection = mat4.create()

    // FIXME: Inverted up vector
    const polarPosition = vec2.create()
    const eye = vec3.create()
    const eyeTarget = vec3.create()
    const center = vec3.create()
    const up = vec3.set(vec3.create(), 0, -1, 0)

    const setup = regl({
      uniforms: {
        ...baseUniforms,
        // FEAT: Improve perspective camera controls
        view: (params, context) => {
          const cameraState = state.controls.camera
          const { polarOffset, polarAngle, depthOffset, tweenFactor } = cameraState

          polarPosition[1] = polarOffset * polarOffset
          radialPosition(eyeTarget, polarPosition, polarAngle / 180 * Math.PI)
          eyeTarget[2] = -(depthOffset * depthOffset)

          eye[0] += (eyeTarget[0] - eye[0]) * tweenFactor
          eye[1] += (eyeTarget[1] - eye[1]) * tweenFactor
          eye[2] += (eyeTarget[2] - eye[2]) * tweenFactor

          vec3.set(center, 0, 0, 0)
          mat4.lookAt(view, eye, center, up)

          return view
        },
        projection: () => projection
      }
    })

    const resize = (event, size) => {
      const aspect = size[0] / size[1]
      const fov = Math.PI * 0.6
      mat4.perspective(projection, fov, aspect, 0.01, 10000)
    }

    return {
      view,
      projection,
      lineScaleFactor: 0,
      shouldAdjustThickness: false,
      setup,
      resize
    }
  })()

  tasks.add((event) => {
    const { size } = state.viewport
    sceneOrtho.resize(event, size)
    scenePerspective.resize(event, size)
  }, 'resize')

  return {
    get scene () {
      // TODO: Improve determining active camera
      const { isRunning } = state.simulation
      return (isRunning && ENABLE_PERSPECTIVE_VIEW) ? scenePerspective : sceneOrtho
    }
  }
}
