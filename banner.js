import { createCanvas } from '@napi-rs/canvas'
import gifenc from 'gifenc'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { GIFEncoder } = gifenc
const width = 640
const height = 200
const frames = 30
const palette = Array.from({ length: 32 }, (_, index) => Array(3).fill(Math.round(index * 255 / 31)))
const stars = Array.from({ length: 120 }, (_, i) => ({
  x: (i * 137.31) % width,
  y: (i * 67.91) % height,
  size: i % 13 === 0 ? 2.4 : 0.5 + (i % 4) * 0.25,
  alpha: 0.15 + (i % 7) * 0.08,
  speed: 1 + i % 2
}))

export function banner(title, artist, paused = false) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const gif = GIFEncoder()
  for (let frame = 0; frame < frames; frame++) {
    const progress = frame / frames
    ctx.fillStyle = '#090909'
    ctx.fillRect(0, 0, width, height)
    for (const star of stars) {
      const y = (star.y + progress * height * star.speed) % height
      ctx.fillStyle = `rgba(255,255,255,${star.alpha})`
      ctx.fillRect(star.x, y, star.size, star.size)
      if (star.size > 2) {
        ctx.fillRect(star.x - 2, y + 1, 6, 1)
        ctx.fillRect(star.x + 1, y - 2, 1, 6)
      }
    }

    ctx.save()
    ctx.translate(102, 100)
    ctx.rotate(paused ? 0 : progress * Math.PI * 2)
    const vinyl = ctx.createLinearGradient(-60, -60, 60, 60)
    vinyl.addColorStop(0, '#4a4a4a')
    vinyl.addColorStop(0.37, '#101010')
    vinyl.addColorStop(0.68, '#202020')
    vinyl.addColorStop(1, '#757575')
    circle(ctx, 73, vinyl, '#c6c6c6')
    for (let radius = 29; radius < 72; radius += 4) circle(ctx, radius, null, '#555555')
    circle(ctx, 25, '#e5e5e5')
    ctx.fillStyle = '#212121'
    ctx.fillRect(-1.5, -19, 3, 11)
    ctx.fillRect(-4, -16, 8, 3)
    circle(ctx, 4, '#141414')
    ctx.restore()

    const panel = ctx.createLinearGradient(185, 0, width - 20, 0)
    panel.addColorStop(0, 'rgba(10,10,10,0.90)')
    panel.addColorStop(1, 'rgba(10,10,10,0.54)')
    ctx.fillStyle = panel
    ctx.fillRect(186, 45, 434, 111)
    ctx.fillStyle = '#b0b0b0'
    ctx.fillRect(186, 45, 2, 111)
    label(ctx, title, 204, 94, 397, 'bold 28px Arial, sans-serif', '#ffffff')
    label(ctx, artist, 204, 126, 397, '18px Arial, sans-serif', '#c7c7c7')

    const { data } = ctx.getImageData(0, 0, width, height)
    const indexed = new Uint8Array(width * height)
    for (let i = 0; i < indexed.length; i++) indexed[i] = Math.round(data[i * 4] * 31 / 255)
    gif.writeFrame(indexed, width, height, { palette: frame === 0 ? palette : undefined, delay: 90, repeat: 0 })
  }
  gif.finish()
  return Buffer.from(gif.bytes())
}

function circle(ctx, radius, fill, stroke) {
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}

function label(ctx, value, x, y, width, font, color) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  let text = value.replace(/\s+/g, ' ').trim()
  if (ctx.measureText(text).width > width) {
    const chars = Array.from(text)
    while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop()
    text = chars.join('') + '…'
  }
  ctx.fillText(text, x, y)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync('preview.gif', banner('المدينة بعد منتصف الليل', 'S0UL'))
}
