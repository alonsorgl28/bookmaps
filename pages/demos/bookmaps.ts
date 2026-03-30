import { layout, prepare, type PreparedText } from '../../src/layout.ts'
import { CATEGORIES, CHAPTERS, type ChapterBlock } from './bookmaps-data.ts'

type BlockState = {
  marker: ChapterBlock
  el: HTMLDivElement
  prepared: PreparedText
  cat: (typeof CATEGORIES)[keyof typeof CATEGORIES]
  _w: number
  targetWeight: number
  rx: number
  ry: number
  rw: number
  rh: number
  currentOpacity: number
  _els: {
    title: HTMLDivElement
    value: HTMLDivElement
    detail: HTMLDivElement
    ref: HTMLDivElement
  } | null
  _tier: number
  _pop: number
  _hoverLevel?: number
}

type FrozenRow = {
  items: BlockState[]
  direction: 'h' | 'v'
}

const treemapEl = document.getElementById('treemap')
const hudBlocks = document.getElementById('hud-blocks')
const hudLayouts = document.getElementById('hud-layouts')
const hudTime = document.getElementById('hud-time')
const legendBar = document.getElementById('legend-bar')
const infoPanel = document.getElementById('info-panel')
const aboutBtn = document.getElementById('about-btn')
const infoClose = document.getElementById('info-close')

if (!(treemapEl instanceof HTMLDivElement)) throw new Error('#treemap not found')
if (!(hudBlocks instanceof HTMLSpanElement)) throw new Error('#hud-blocks not found')
if (!(hudLayouts instanceof HTMLSpanElement)) throw new Error('#hud-layouts not found')
if (!(hudTime instanceof HTMLSpanElement)) throw new Error('#hud-time not found')
if (!(legendBar instanceof HTMLDivElement)) throw new Error('#legend-bar not found')
if (!(infoPanel instanceof HTMLDivElement)) throw new Error('#info-panel not found')
if (!(aboutBtn instanceof HTMLButtonElement)) throw new Error('#about-btn not found')
if (!(infoClose instanceof HTMLButtonElement)) throw new Error('#info-close not found')

let frozenRows: FrozenRow[] = []
let mouseX = -9999
let mouseY = -9999
const CURSOR_RADIUS = 220
const EXPAND_FACTOR = 3.0
const LERP = 0.1
let blocks: BlockState[] = []
let activeCat: keyof typeof CATEGORIES | null = null
const DETAIL_FONT = '8px Inter'
const LH = 11

function buildRowStructure(items: BlockState[]): FrozenRow[] {
  const sorted = [...items].sort((a, b) => b.marker.weight - a.marker.weight)
  const totalWeight = sorted.reduce((sum, item) => sum + item.marker.weight, 0)
  if (totalWeight <= 0) return []

  const rows: FrozenRow[] = []
  let remaining = [...sorted]
  let areaLeft = totalWeight
  const vw = window.innerWidth
  const vh = window.innerHeight - legendBar.getBoundingClientRect().height
  let w = vw
  let h = vh

  while (remaining.length > 0) {
    const shorter = Math.min(w, h)
    let row = [remaining[0]!]
    let bestWorst = calcWorst(row, shorter, row[0]!.marker.weight / areaLeft * w * h)
    let index = 1

    while (index < remaining.length) {
      const test = [...row, remaining[index]!]
      const testArea = test.reduce((sum, item) => sum + item.marker.weight, 0) / areaLeft * w * h
      const testWorst = calcWorst(test, shorter, testArea)
      if (testWorst <= bestWorst) {
        row = test
        bestWorst = testWorst
        index++
      } else {
        break
      }
    }

    const rowWeight = row.reduce((sum, item) => sum + item.marker.weight, 0)
    const rowFrac = rowWeight / areaLeft
    const horizontal = w >= h
    rows.push({ items: row, direction: horizontal ? 'h' : 'v' })

    if (horizontal) w -= w * rowFrac
    else h -= h * rowFrac
    areaLeft -= rowWeight
    remaining = remaining.slice(row.length)
  }

  return rows
}

function calcWorst(row: BlockState[], shorter: number, rowArea: number): number {
  if (rowArea <= 0 || shorter <= 0) return Infinity
  const strip = rowArea / shorter
  const rowWeight = row.reduce((sum, item) => sum + (item.marker?.weight || item._w), 0)
  let worst = 0
  for (let index = 0; index < row.length; index++) {
    const item = row[index]!
    const weight = item.marker?.weight || item._w
    const breadth = (rowArea * (weight / rowWeight)) / strip
    const ratio = Math.max(strip / breadth, breadth / strip)
    if (ratio > worst) worst = ratio
  }
  return worst
}

function layoutFromRows(rows: FrozenRow[], rect: { x: number, y: number, w: number, h: number }) {
  const results: Array<{ item: BlockState, x: number, y: number, w: number, h: number }> = []
  let { x, y, w, h } = rect
  const totalWeight = rows.reduce((sum, row) => sum + row.items.reduce((inner, block) => inner + block._w, 0), 0)
  if (totalWeight <= 0) return results
  let weightLeft = totalWeight

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    const rowWeight = row.items.reduce((sum, block) => sum + block._w, 0)
    const rowFrac = rowWeight / weightLeft

    if (row.direction === 'h') {
      const rw = w * rowFrac
      let yy = y
      for (let itemIndex = 0; itemIndex < row.items.length; itemIndex++) {
        const block = row.items[itemIndex]!
        const ih = h * (block._w / rowWeight)
        results.push({ item: block, x, y: yy, w: rw, h: ih })
        yy += ih
      }
      x += rw
      w -= rw
    } else {
      const rh = h * rowFrac
      let xx = x
      for (let itemIndex = 0; itemIndex < row.items.length; itemIndex++) {
        const block = row.items[itemIndex]!
        const iw = w * (block._w / rowWeight)
        results.push({ item: block, x: xx, y, w: iw, h: rh })
        xx += iw
      }
      y += rh
      h -= rh
    }

    weightLeft -= rowWeight
  }

  return results
}

function updateLegendActive(): void {
  legendBar.querySelectorAll('.legend-item').forEach(element => {
    element.classList.toggle('active', (element as HTMLElement).dataset.cat === activeCat)
  })
}

function init(): void {
  Object.entries(CATEGORIES).forEach(([key, cat]) => {
    const item = document.createElement('div')
    item.className = 'legend-item'
    item.dataset.cat = key
    item.innerHTML = `<span class="dot" style="background:${cat.accent}"></span><span class="lbl">${cat.label}</span>`
    const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0
    item.addEventListener('mouseenter', () => {
      if (!isTouch()) {
        activeCat = key as keyof typeof CATEGORIES
        updateLegendActive()
      }
    })
    item.addEventListener('mouseleave', () => {
      if (!isTouch()) {
        activeCat = null
        updateLegendActive()
      }
    })
    item.addEventListener('click', event => {
      event.preventDefault()
      activeCat = activeCat === key ? null : key as keyof typeof CATEGORIES
      updateLegendActive()
    })
    legendBar.appendChild(item)
  })

  blocks = CHAPTERS.map(marker => {
    const cat = CATEGORIES[marker.cat]
    const el = document.createElement('div')
    el.className = 'block'
    el.dataset.cat = marker.cat
    el.style.backgroundColor = cat.bg
    el.style.color = cat.fg
    el.innerHTML = `
      <div class="block-title">${marker.name}</div>
      <div class="block-value">${marker.val}</div>
      <div class="block-detail">${marker.detail}</div>
      <div class="block-ref">${marker.ref}</div>
    `
    treemapEl.appendChild(el)
    const fullText = `${marker.name} ${marker.val} ${marker.ref} ${marker.detail}`
    return {
      marker,
      el,
      prepared: prepare(fullText, DETAIL_FONT),
      cat,
      _w: marker.weight,
      targetWeight: marker.weight,
      rx: 0,
      ry: 0,
      rw: 100,
      rh: 100,
      currentOpacity: 1,
      _els: null,
      _tier: -1,
      _pop: -1,
    }
  })

  hudBlocks.textContent = String(blocks.length)
}

document.addEventListener('mousemove', event => {
  mouseX = event.clientX
  mouseY = event.clientY
})
document.addEventListener('mouseleave', () => {
  mouseX = -9999
  mouseY = -9999
})

let touchTimer: ReturnType<typeof setTimeout> | null = null
document.addEventListener('touchstart', event => {
  if (infoPanel.classList.contains('visible')) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('.legend-bar') || target.closest('.about-btn') || target.closest('.info-panel')) return
  mouseX = event.touches[0]!.clientX
  mouseY = event.touches[0]!.clientY
  if (touchTimer !== null) clearTimeout(touchTimer)
}, { passive: true })

document.addEventListener('touchmove', event => {
  if (infoPanel.classList.contains('visible')) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('.legend-bar')) return
  mouseX = event.touches[0]!.clientX
  mouseY = event.touches[0]!.clientY
  event.preventDefault()
}, { passive: false })

document.addEventListener('touchend', () => {
  if (touchTimer !== null) clearTimeout(touchTimer)
  touchTimer = setTimeout(() => {
    mouseX = -9999
    mouseY = -9999
  }, 800)
})

aboutBtn.addEventListener('click', () => {
  infoPanel.classList.add('visible')
  infoPanel.scrollTop = 0
})
infoClose.addEventListener('click', event => {
  event.stopPropagation()
  infoPanel.classList.remove('visible')
})

function lerpColor(a: string, b: string, t: number): string {
  const ar = Number.parseInt(a.slice(1, 3), 16)
  const ag = Number.parseInt(a.slice(3, 5), 16)
  const ab = Number.parseInt(a.slice(5, 7), 16)
  const br = Number.parseInt(b.slice(1, 3), 16)
  const bg = Number.parseInt(b.slice(3, 5), 16)
  const bb = Number.parseInt(b.slice(5, 7), 16)
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`
}

function tick(): void {
  const vw = window.innerWidth
  const vh = window.innerHeight - legendBar.getBoundingClientRect().height

  let layoutCalls = 0
  const startedAt = performance.now()

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    let expand = 1
    const cx = block.rx + block.rw / 2
    const cy = block.ry + block.rh / 2
    const dist = Math.sqrt((mouseX - cx) ** 2 + (mouseY - cy) ** 2)
    if (dist < CURSOR_RADIUS) {
      const force = 1 - dist / CURSOR_RADIUS
      expand = 1 + force * force * EXPAND_FACTOR
    }
    if (activeCat !== null) {
      if (block.marker.cat === activeCat) expand = Math.max(expand, 2.5)
      else expand = Math.min(expand, 0.5)
    }
    block.targetWeight = block.marker.weight * expand
    block._w += (block.targetWeight - block._w) * LERP
    const targetOpacity = activeCat !== null ? (block.marker.cat === activeCat ? 1 : 0.15) : 1
    block.currentOpacity += (targetOpacity - block.currentOpacity) * 0.15
  }

  const rects = layoutFromRows(frozenRows, { x: 0, y: 0, w: vw, h: vh })
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index]!
    const block = rect.item
    block.rx += (rect.x - block.rx) * LERP
    block.ry += (rect.y - block.ry) * LERP
    block.rw += (rect.w - block.rw) * LERP
    block.rh += (rect.h - block.rh) * LERP

    const rx = Math.round(block.rx * 10) / 10
    const ry = Math.round(block.ry * 10) / 10
    const rw = Math.round(block.rw)
    const rh = Math.round(block.rh)

    block.el.style.transform = `translate(${rx}px,${ry}px)`
    block.el.style.width = `${rw}px`
    block.el.style.height = `${rh}px`

    const opacityKey = Math.round(block.currentOpacity * 100)
    if (block._pop !== opacityKey) {
      block.el.style.opacity = String(block.currentOpacity)
      block._pop = opacityKey
    }

    const dist = Math.sqrt((mouseX - (block.rx + block.rw / 2)) ** 2 + (mouseY - (block.ry + block.rh / 2)) ** 2)
    const intensity = dist < CURSOR_RADIUS ? (1 - dist / CURSOR_RADIUS) : 0
    const hoverLevel = Math.round(intensity * 5)
    if (block._hoverLevel !== hoverLevel) {
      if (hoverLevel > 0) {
        const factor = hoverLevel / 5
        block.el.style.backgroundColor = lerpColor(block.cat.bg, block.cat.bgHover, factor)
        block.el.style.boxShadow = `0 ${Math.round(factor * 6)}px ${Math.round(factor * 20)}px rgba(0,0,0,${(factor * 0.15).toFixed(2)})`
        block.el.style.zIndex = String(10 + Math.round(factor * 10))
      } else {
        block.el.style.backgroundColor = block.cat.bg
        block.el.style.boxShadow = ''
        block.el.style.zIndex = '0'
      }
      block._hoverLevel = hoverLevel
    }

    const availW = Math.max(20, rw - 12)
    layout(block.prepared, availW, LH)
    layoutCalls++
    const area = rw * rh

    let tier = 0
    if (area >= 18000) tier = 4
    else if (area >= 7000) tier = 3
    else if (area >= 2500) tier = 2
    else if (area >= 600) tier = 1

    if (block._els === null) {
      const title = block.el.querySelector('.block-title')
      const value = block.el.querySelector('.block-value')
      const detail = block.el.querySelector('.block-detail')
      const ref = block.el.querySelector('.block-ref')
      if (!(title instanceof HTMLDivElement) || !(value instanceof HTMLDivElement) || !(detail instanceof HTMLDivElement) || !(ref instanceof HTMLDivElement)) {
        throw new Error('block children not found')
      }
      block._els = { title, value, detail, ref }
    }

    if (block._tier !== tier || tier === 4) {
      const { title, value, detail, ref } = block._els
      if (tier === 0) {
        title.style.display = 'none'
        value.style.display = 'none'
        detail.style.display = 'none'
        ref.style.display = 'none'
      } else if (tier === 1) {
        title.style.display = ''
        title.style.fontSize = '7px'
        value.style.display = 'none'
        detail.style.display = 'none'
        ref.style.display = 'none'
      } else if (tier === 2) {
        title.style.display = ''
        title.style.fontSize = '8px'
        value.style.display = ''
        value.style.fontSize = '10px'
        detail.style.display = 'none'
        ref.style.display = 'none'
      } else if (tier === 3) {
        title.style.display = ''
        title.style.fontSize = '9px'
        value.style.display = ''
        value.style.fontSize = '13px'
        detail.style.display = 'none'
        ref.style.display = ''
      } else {
        title.style.display = ''
        title.style.fontSize = `${Math.min(13, 8 + area / 12000)}px`
        value.style.display = ''
        value.style.fontSize = `${Math.min(22, 13 + area / 6000)}px`
        detail.style.display = ''
        detail.style.fontSize = `${Math.min(11, 8 + area / 20000)}px`
        detail.style.maxHeight = `${Math.max(0, rh - 48 - 8)}px`
        ref.style.display = ''
      }
      block._tier = tier
    }
  }

  const elapsed = performance.now() - startedAt
  hudLayouts.textContent = String(layoutCalls)
  hudTime.textContent = elapsed.toFixed(2)
  requestAnimationFrame(tick)
}

document.fonts.ready.then(() => {
  init()
  frozenRows = buildRowStructure(blocks)
  for (let index = 0; index < blocks.length; index++) blocks[index]!._w = blocks[index]!.marker.weight
  const vw = window.innerWidth
  const vh = window.innerHeight - legendBar.getBoundingClientRect().height
  const rects = layoutFromRows(frozenRows, { x: 0, y: 0, w: vw, h: vh })
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index]!
    rect.item.rx = rect.x
    rect.item.ry = rect.y
    rect.item.rw = rect.w
    rect.item.rh = rect.h
  }
  requestAnimationFrame(tick)
})

let resizeTimer: ReturnType<typeof setTimeout> | null = null
window.addEventListener('resize', () => {
  if (resizeTimer !== null) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    frozenRows = buildRowStructure(blocks)
    for (let index = 0; index < blocks.length; index++) blocks[index]!._w = blocks[index]!.marker.weight
  }, 150)
})
