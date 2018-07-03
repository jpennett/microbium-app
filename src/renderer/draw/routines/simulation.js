const { PI } = Math

export function drawSimulatorUI (state, ctx) {
  if (!state.simulation.isRunning) return
  const { tick } = state.simulation
  const { center, size } = state.viewport
  const { overlay } = state.controls.viewport

  const offsetA = 6 + Math.sin(tick * 0.02) * 2
  const offsetB = 10 + Math.sin(tick * 0.02) * 2

  ctx.save()
  ctx.translate(-center[0], -center[1])

  ctx.globalAlpha = 0.8 * overlay.alphaFactor
  ctx.strokeStyle = overlay.colorHighlightHex

  ctx.lineWidth = 3
  ctx.strokeRect(offsetA, offsetA,
    size[0] - offsetA * 2, size[1] - offsetA * 2)

  ctx.lineWidth = 0.5
  ctx.strokeRect(offsetB, offsetB,
    size[0] - offsetB * 2, size[1] - offsetB * 2)

  ctx.restore()
}

// TODO: Redesign simulator origin UI
export function drawSimulatorOriginUI (state, ctx) {
  // if (!state.simulation.isRunning) return
  // const { diffusor, rotator } = state.simulationForces

  // ctx.save()
  // ctx.globalAlpha = 0.8

  // ctx.strokeStyle = UI_PALETTE.BACK_PRIMARY
  // ctx.lineWidth = 1.5
  // ctx.beginPath()
  // ctx.arc(0, 0, 14, 0, -rotator.intensity * 100 * PI, rotator.intensity > 0)
  // ctx.stroke()

  // ctx.strokeStyle = UI_PALETTE.BACK_SECONDARY
  // ctx.lineWidth = 1
  // ctx.beginPath()
  // ctx.arc(0, 0, 14 + diffusor.intensity * 100 * 8, 0, PI * 2)
  // ctx.stroke()

  // ctx.restore()
}

// TODO: Redesign configurable forces UI
export function drawSimulatorForceUI (state, ctx, intensityRadius, alpha) {
  const { points } = state.simulationForces
  const { scale } = state.viewport
  const { overlay } = state.controls.viewport
  const scaleInv = 1 / scale

  points.forEach(({position, force}) => {
    const { intensity, radius } = force

    ctx.globalAlpha = 0.8 * alpha * overlay.alphaFactor
    ctx.strokeStyle = overlay.colorHighlightHex
    ctx.lineWidth = 1 * scaleInv
    ctx.beginPath()
    ctx.arc(position[0], position[1],
      intensityRadius + intensity * 1.5,
      0, PI * 2)
    ctx.stroke()

    ctx.globalAlpha = 0.1 * alpha * overlay.alphaFactor
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.8 * scaleInv
    ctx.beginPath()
    ctx.arc(position[0], position[1],
      radius,
      0, PI * 2)
    ctx.stroke()
  })
}
