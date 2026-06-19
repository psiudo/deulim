import {
  Box,
  Check,
  Command,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Grid3X3,
  Layers3,
  Maximize,
  MousePointer2,
  Move,
  PenLine,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  Search,
  Square,
  Trash2,
  Undo2,
  AppWindow,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { DragEvent, PointerEvent as ReactPointerEvent, WheelEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import './App.css'

type Point = {
  x: number
  y: number
}

type Wall = {
  id: string
  start: Point
  end: Point
  thicknessCm: number
  heightCm: number
}

type OpeningType = 'door' | 'window'

type Opening = {
  id: string
  type: OpeningType
  wallId: string
  offsetCm: number
  widthCm: number
  heightCm: number
  sillHeightCm: number
  swing: 'left' | 'right'
}

type Asset = {
  id: string
  name: string
  x: number
  y: number
  widthCm: number
  depthCm: number
  heightCm: number
  rotationDeg: number
  color: string
}

type FloorPlan = {
  walls: Wall[]
  openings: Opening[]
  assets: Asset[]
  floor: {
    elevationCm: number
    thicknessCm: number
  }
}

type Tool =
  | 'select'
  | 'wall'
  | 'rectangle'
  | 'structure'
  | 'door'
  | 'window'
  | 'furniture'
  | 'measure'
  | 'pan'

type Selection =
  | { type: 'wall'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'asset'; id: string }
  | { type: 'floor' }
  | null

type HistoryState = {
  plan: FloorPlan
  past: FloorPlan[]
  future: FloorPlan[]
}

type DragState =
  | {
      type: 'endpoint'
      wallId: string
      endpoint: 'start' | 'end'
      base: FloorPlan
      moved: boolean
    }
  | {
      type: 'wall'
      wallId: string
      base: FloorPlan
      startWorld: Point
      moved: boolean
    }
  | {
      type: 'opening'
      openingId: string
      base: FloorPlan
      moved: boolean
    }
  | {
      type: 'asset'
      assetId: string
      base: FloorPlan
      offset: Point
      moved: boolean
    }
  | {
      type: 'pan'
      startScreen: Point
      startPan: Point
      moved: boolean
    }

type Viewport = {
  zoom: number
  pan: Point
}

type FurnitureDraft = {
  name: string
  widthCm: number
  depthCm: number
  heightCm: number
}

type CommandItem = {
  id: string
  label: string
  shortcut: string
  disabled?: boolean
}

type ThreeViewMode = 'orbit' | 'top' | 'eye'

const STORAGE_KEY = 'deulim.floor-plan.v1'
const GRID_CM = 10
const SNAP_DISTANCE_CM = 12
const DEFAULT_WALL_THICKNESS_CM = 12
const DEFAULT_WALL_HEIGHT_CM = 240
const DEFAULT_FLOOR_THICKNESS_CM = 15
const CM_TO_M = 0.01

const emptyPlan: FloorPlan = {
  walls: [],
  openings: [],
  assets: [],
  floor: {
    elevationCm: 0,
    thicknessCm: DEFAULT_FLOOR_THICKNESS_CM,
  },
}

const toolItems: Array<{
  id: Tool
  label: string
  icon: typeof MousePointer2
  shortcut?: string
}> = [
  { id: 'select', label: '선택', icon: MousePointer2, shortcut: 'V' },
  { id: 'wall', label: '벽 그리기', icon: PenLine, shortcut: 'L' },
  { id: 'rectangle', label: '직사각형 방', icon: Square },
  { id: 'structure', label: '구조물', icon: Box },
  { id: 'door', label: '문 추가', icon: DoorOpen, shortcut: 'D' },
  { id: 'window', label: '창문 추가', icon: AppWindow, shortcut: 'N' },
  { id: 'furniture', label: '가구 배치', icon: Box, shortcut: 'B' },
  { id: 'measure', label: '치수 측정', icon: Ruler, shortcut: 'M' },
  { id: 'pan', label: '화면 이동', icon: Move, shortcut: 'H' },
]

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function clonePlan(plan: FloorPlan): FloorPlan {
  return JSON.parse(JSON.stringify(plan)) as FloorPlan
}

function normalizePlan(value: unknown): FloorPlan {
  if (!value || typeof value !== 'object') {
    return clonePlan(emptyPlan)
  }

  const candidate = value as Partial<FloorPlan>
  return {
    walls: Array.isArray(candidate.walls) ? candidate.walls : [],
    openings: Array.isArray(candidate.openings) ? candidate.openings : [],
    assets: Array.isArray(candidate.assets) ? candidate.assets : [],
    floor: {
      elevationCm: Number.isFinite(candidate.floor?.elevationCm) ? candidate.floor!.elevationCm : 0,
      thicknessCm: Number.isFinite(candidate.floor?.thicknessCm)
        ? Math.max(1, candidate.floor!.thicknessCm)
        : DEFAULT_FLOOR_THICKNESS_CM,
    },
  }
}

function loadPlan(): FloorPlan {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? normalizePlan(JSON.parse(saved)) : clonePlan(emptyPlan)
  } catch {
    return clonePlan(emptyPlan)
  }
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function wallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function areSamePoint(a: Point, b: Point, tolerance = 0.1) {
  return distance(a, b) <= tolerance
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function roundCm(value: number) {
  return Math.round(value)
}

function angleDeg(a: Point, b: Point) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function snapToGrid(point: Point): Point {
  return {
    x: Math.round(point.x / GRID_CM) * GRID_CM,
    y: Math.round(point.y / GRID_CM) * GRID_CM,
  }
}

function projectPointToSegment(point: Point, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    return { point: wall.start, distanceCm: distance(point, wall.start), offsetCm: 0 }
  }
  const t = clamp(
    ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSq,
    0,
    1,
  )
  const projected = {
    x: wall.start.x + dx * t,
    y: wall.start.y + dy * t,
  }
  return {
    point: projected,
    distanceCm: distance(point, projected),
    offsetCm: Math.sqrt(lengthSq) * t,
  }
}

function findNearestWall(plan: FloorPlan, point: Point, maxDistanceCm = 28) {
  let best:
    | {
        wall: Wall
        point: Point
        offsetCm: number
        distanceCm: number
      }
    | null = null

  for (const wall of plan.walls) {
    const projection = projectPointToSegment(point, wall)
    if (!best || projection.distanceCm < best.distanceCm) {
      best = {
        wall,
        point: projection.point,
        offsetCm: projection.offsetCm,
        distanceCm: projection.distanceCm,
      }
    }
  }

  return best && best.distanceCm <= maxDistanceCm ? best : null
}

function collectSnapPoints(plan: FloorPlan, drawPoints: Point[]) {
  return [
    ...drawPoints,
    ...plan.walls.flatMap((wall) => [wall.start, wall.end]),
    ...plan.assets.map((asset) => ({ x: asset.x, y: asset.y })),
  ]
}

function snapWorldPoint(
  rawPoint: Point,
  plan: FloorPlan,
  drawPoints: Point[],
  shiftKey: boolean,
) {
  let candidate = snapToGrid(rawPoint)
  const previousPoint = drawPoints.at(-1)

  if (shiftKey && previousPoint) {
    const dx = candidate.x - previousPoint.x
    const dy = candidate.y - previousPoint.y
    candidate =
      Math.abs(dx) >= Math.abs(dy)
        ? { x: candidate.x, y: previousPoint.y }
        : { x: previousPoint.x, y: candidate.y }
  }

  for (const snapPoint of collectSnapPoints(plan, drawPoints)) {
    if (distance(candidate, snapPoint) <= SNAP_DISTANCE_CM) {
      return { ...snapPoint }
    }
  }

  const wallSnap = findNearestWall(plan, candidate, SNAP_DISTANCE_CM)
  return wallSnap ? wallSnap.point : candidate
}

function makeWallsFromPoints(points: Point[]) {
  const walls: Wall[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (distance(start, end) > 0.5) {
      walls.push({
        id: makeId('wall'),
        start,
        end,
        thicknessCm: DEFAULT_WALL_THICKNESS_CM,
        heightCm: DEFAULT_WALL_HEIGHT_CM,
      })
    }
  }
  return walls
}

function getClosedPolygon(walls: Wall[]) {
  if (walls.length < 3) {
    return null
  }

  for (let index = 0; index < walls.length - 1; index += 1) {
    if (!areSamePoint(walls[index].end, walls[index + 1].start, 1)) {
      return null
    }
  }

  const first = walls[0].start
  const last = walls[walls.length - 1].end
  return areSamePoint(first, last, 1) ? walls.map((wall) => wall.start) : null
}

function pointInsidePolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) {
      inside = !inside
    }
  }
  return inside
}

function ccw(a: Point, b: Point, c: Point) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  if (
    areSamePoint(a, c, 1) ||
    areSamePoint(a, d, 1) ||
    areSamePoint(b, c, 1) ||
    areSamePoint(b, d, 1)
  ) {
    return false
  }
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)
}

function assetBounds(asset: Asset) {
  return {
    left: asset.x - asset.widthCm / 2,
    right: asset.x + asset.widthCm / 2,
    top: asset.y - asset.depthCm / 2,
    bottom: asset.y + asset.depthCm / 2,
  }
}

function boundsOverlap(a: ReturnType<typeof assetBounds>, b: ReturnType<typeof assetBounds>) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function collectWarnings(plan: FloorPlan) {
  const warnings: string[] = []
  const polygon = getClosedPolygon(plan.walls)

  if (plan.walls.length > 0 && !polygon) {
    warnings.push('벽이 아직 닫힌 방으로 연결되지 않았습니다.')
  }

  for (let index = 0; index < plan.walls.length - 1; index += 1) {
    if (!areSamePoint(plan.walls[index].end, plan.walls[index + 1].start, 1)) {
      warnings.push('벽 사이에 미세한 틈이 있습니다.')
      break
    }
  }

  for (let a = 0; a < plan.walls.length; a += 1) {
    for (let b = a + 1; b < plan.walls.length; b += 1) {
      const adjacent = Math.abs(a - b) === 1 || (a === 0 && b === plan.walls.length - 1)
      if (!adjacent && segmentsIntersect(plan.walls[a].start, plan.walls[a].end, plan.walls[b].start, plan.walls[b].end)) {
        warnings.push('교차된 벽이 있습니다.')
      }
    }
  }

  if (polygon) {
    for (const asset of plan.assets) {
      if (!pointInsidePolygon({ x: asset.x, y: asset.y }, polygon)) {
        warnings.push(`${asset.name}이 방 바깥에 있습니다.`)
      }
    }
  }

  for (let a = 0; a < plan.assets.length; a += 1) {
    for (let b = a + 1; b < plan.assets.length; b += 1) {
      if (boundsOverlap(assetBounds(plan.assets[a]), assetBounds(plan.assets[b]))) {
        warnings.push('가구끼리 겹치는 영역이 있습니다.')
      }
    }
  }

  return Array.from(new Set(warnings))
}

function updateConnectedPoint(plan: FloorPlan, oldPoint: Point, nextPoint: Point) {
  return {
    ...plan,
    walls: plan.walls.map((wall) => ({
      ...wall,
      start: areSamePoint(wall.start, oldPoint, 1) ? nextPoint : wall.start,
      end: areSamePoint(wall.end, oldPoint, 1) ? nextPoint : wall.end,
    })),
  }
}

function updateWallLengthInPlan(plan: FloorPlan, wallId: string, lengthCm: number) {
  const wall = plan.walls.find((item) => item.id === wallId)
  if (!wall || lengthCm <= 1) {
    return plan
  }

  const currentLength = wallLength(wall)
  if (currentLength <= 0) {
    return plan
  }

  const unitX = (wall.end.x - wall.start.x) / currentLength
  const unitY = (wall.end.y - wall.start.y) / currentLength
  const oldEnd = wall.end
  const nextEnd = {
    x: wall.start.x + unitX * lengthCm,
    y: wall.start.y + unitY * lengthCm,
  }

  return updateConnectedPoint(plan, oldEnd, nextEnd)
}

function updateWallNumeric(plan: FloorPlan, wallId: string, field: 'thicknessCm' | 'heightCm', value: number) {
  return {
    ...plan,
    walls: plan.walls.map((wall) =>
      wall.id === wallId ? { ...wall, [field]: Math.max(1, value) } : wall,
    ),
  }
}

function openingPlacement(plan: FloorPlan, opening: Opening) {
  const wall = plan.walls.find((item) => item.id === opening.wallId)
  if (!wall) {
    return null
  }

  const length = wallLength(wall)
  if (length === 0) {
    return null
  }

  const offset = clamp(opening.offsetCm, 0, length)
  const ratio = offset / length
  const point = {
    x: wall.start.x + (wall.end.x - wall.start.x) * ratio,
    y: wall.start.y + (wall.end.y - wall.start.y) * ratio,
  }

  return {
    wall,
    point,
    angle: angleDeg(wall.start, wall.end),
    length,
  }
}

function createOpening(type: OpeningType, wall: Wall, offsetCm: number): Opening {
  const widthCm = type === 'door' ? 85 : 120
  return {
    id: makeId(type),
    type,
    wallId: wall.id,
    offsetCm: clamp(offsetCm, widthCm / 2, Math.max(widthCm / 2, wallLength(wall) - widthCm / 2)),
    widthCm,
    heightCm: type === 'door' ? 210 : 110,
    sillHeightCm: type === 'door' ? 0 : 90,
    swing: 'left',
  }
}

function makeAsset(point: Point, draft: FurnitureDraft): Asset {
  return {
    id: makeId('asset'),
    name: draft.name.trim() || '기본 가구',
    x: point.x,
    y: point.y,
    widthCm: draft.widthCm,
    depthCm: draft.depthCm,
    heightCm: draft.heightCm,
    rotationDeg: 0,
    color: '#d99441',
  }
}

function planBounds(plan: FloorPlan) {
  const points = [
    ...plan.walls.flatMap((wall) => [wall.start, wall.end]),
    ...plan.assets.flatMap((asset) => [
      { x: asset.x - asset.widthCm / 2, y: asset.y - asset.depthCm / 2 },
      { x: asset.x + asset.widthCm / 2, y: asset.y + asset.depthCm / 2 },
    ]),
  ]

  if (points.length === 0) {
    return { minX: -80, minY: -80, maxX: 480, maxY: 360 }
  }

  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  )
}

function makePath(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function polygonCenter(points: Point[]) {
  return points.reduce(
    (center, point) => ({
      x: center.x + point.x / points.length,
      y: center.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  )
}

function App() {
  const canvasRef = useRef<SVGSVGElement | null>(null)
  const wallLengthInputRef = useRef<HTMLInputElement | null>(null)
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const [history, setHistory] = useState<HistoryState>(() => ({
    plan: loadPlan(),
    past: [],
    future: [],
  }))
  const [selected, setSelected] = useState<Selection>(null)
  const [tool, setTool] = useState<Tool>('wall')
  const [drawPoints, setDrawPoints] = useState<Point[]>([])
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [spacePan, setSpacePan] = useState(false)
  const [draftLengthCm, setDraftLengthCm] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({
    zoom: 1,
    pan: { x: 160, y: 110 },
  })
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [furnitureDraft, setFurnitureDraft] = useState<FurnitureDraft>({
    name: '수납함',
    widthCm: 80,
    depthCm: 40,
    heightCm: 72,
  })

  const plan = history.plan
  const effectiveTool: Tool = spacePan ? 'pan' : tool
  const polygon = useMemo(() => getClosedPolygon(plan.walls), [plan.walls])
  const warnings = useMemo(() => collectWarnings(plan), [plan])
  const selectedWall = selected?.type === 'wall' ? plan.walls.find((wall) => wall.id === selected.id) : null
  const selectedOpening = selected?.type === 'opening' ? plan.openings.find((opening) => opening.id === selected.id) : null
  const selectedAsset = selected?.type === 'asset' ? plan.assets.find((asset) => asset.id === selected.id) : null
  const selectedFloor = selected?.type === 'floor'
  const floorLabelPoint = useMemo(() => (polygon ? polygonCenter(polygon) : null), [polygon])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
  }, [plan])

  useEffect(() => {
    if (commandOpen) {
      requestAnimationFrame(() => commandInputRef.current?.focus())
    }
  }, [commandOpen])

  const replaceLivePlan = useCallback((nextPlan: FloorPlan) => {
    setHistory((current) => ({
      ...current,
      plan: nextPlan,
    }))
  }, [])

  const commitPlan = useCallback((recipe: (draft: FloorPlan) => FloorPlan, nextSelection?: Selection) => {
    setHistory((current) => {
      const before = clonePlan(current.plan)
      const next = recipe(clonePlan(current.plan))
      return {
        plan: next,
        past: [...current.past, before].slice(-80),
        future: [],
      }
    })
    if (nextSelection !== undefined) {
      setSelected(nextSelection)
    }
  }, [])

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1)
      if (!previous) {
        return current
      }
      return {
        plan: previous,
        past: current.past.slice(0, -1),
        future: [clonePlan(current.plan), ...current.future],
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0]
      if (!next) {
        return current
      }
      return {
        plan: next,
        past: [...current.past, clonePlan(current.plan)],
        future: current.future.slice(1),
      }
    })
  }, [])

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = canvasRef.current?.getBoundingClientRect()
      if (!bounds) {
        return { x: 0, y: 0 }
      }
      return {
        x: (clientX - bounds.left - viewport.pan.x) / viewport.zoom,
        y: (clientY - bounds.top - viewport.pan.y) / viewport.zoom,
      }
    },
    [viewport],
  )

  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return { x: 0, y: 0 }
    }
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    }
  }, [])

  const addWallPoint = useCallback(
    (point: Point) => {
      if (drawPoints.length === 0) {
        setDrawPoints([point])
        setHoverPoint(point)
        setDraftLengthCm('')
        return
      }

      const firstPoint = drawPoints[0]
      const lastPoint = drawPoints.at(-1)
      if (!lastPoint || areSamePoint(point, lastPoint, 0.5)) {
        return
      }

      const shouldClose = drawPoints.length >= 3 && distance(point, firstPoint) <= SNAP_DISTANCE_CM
      if (shouldClose) {
        const completedPoints = [...drawPoints, firstPoint]
        const nextWalls = makeWallsFromPoints(completedPoints)
        commitPlan(
          (draft) => ({
            ...draft,
            walls: [...draft.walls, ...nextWalls],
          }),
          nextWalls[0] ? { type: 'wall', id: nextWalls[0].id } : null,
        )
        setDrawPoints([])
        setHoverPoint(null)
        setDraftLengthCm('')
        return
      }

      setDrawPoints((current) => [...current, point])
      setDraftLengthCm('')
    },
    [commitPlan, drawPoints],
  )

  const finishOpenWallDrawing = useCallback(() => {
    if (drawPoints.length < 2) {
      setDrawPoints([])
      setHoverPoint(null)
      return
    }
    const nextWalls = makeWallsFromPoints(drawPoints)
    commitPlan((draft) => ({ ...draft, walls: [...draft.walls, ...nextWalls] }))
    setDrawPoints([])
    setHoverPoint(null)
    setDraftLengthCm('')
  }, [commitPlan, drawPoints])

  const commitExactWallLength = useCallback(() => {
    const lastPoint = drawPoints.at(-1)
    const lengthCm = Number(draftLengthCm)
    if (!lastPoint || !Number.isFinite(lengthCm) || lengthCm <= 0) {
      return
    }

    const directionPoint = hoverPoint && distance(lastPoint, hoverPoint) > 0.5
      ? hoverPoint
      : { x: lastPoint.x + 1, y: lastPoint.y }
    const directionLength = distance(lastPoint, directionPoint)
    const nextPoint = {
      x: lastPoint.x + ((directionPoint.x - lastPoint.x) / directionLength) * lengthCm,
      y: lastPoint.y + ((directionPoint.y - lastPoint.y) / directionLength) * lengthCm,
    }

    addWallPoint(nextPoint)
    setHoverPoint(nextPoint)
    setDraftLengthCm('')
    wallLengthInputRef.current?.blur()
  }, [addWallPoint, draftLengthCm, drawPoints, hoverPoint])

  const placeOpening = useCallback(
    (type: OpeningType, point: Point) => {
      const nearestWall = findNearestWall(plan, point)
      if (!nearestWall) {
        return
      }
      const opening = createOpening(type, nearestWall.wall, nearestWall.offsetCm)
      commitPlan(
        (draft) => ({
          ...draft,
          openings: [...draft.openings, opening],
        }),
        { type: 'opening', id: opening.id },
      )
    },
    [commitPlan, plan],
  )

  const placeFurniture = useCallback(
    (point: Point) => {
      const asset = makeAsset(point, furnitureDraft)
      commitPlan(
        (draft) => ({
          ...draft,
          assets: [...draft.assets, asset],
        }),
        { type: 'asset', id: asset.id },
      )
    },
    [commitPlan, furnitureDraft],
  )

  const createRectangleRoom = useCallback(() => {
    const points = [
      { x: 0, y: 0 },
      { x: 360, y: 0 },
      { x: 360, y: 260 },
      { x: 0, y: 260 },
      { x: 0, y: 0 },
    ]
    const walls = makeWallsFromPoints(points)
    commitPlan(
      (draft) => ({
        ...draft,
        walls: [...draft.walls, ...walls],
      }),
      walls[0] ? { type: 'wall', id: walls[0].id } : null,
    )
  }, [commitPlan])

  const drawStructure = useCallback(() => {
    const asset = makeAsset({ x: 140, y: 110 }, {
      name: '배관 박스',
      widthCm: 45,
      depthCm: 45,
      heightCm: 230,
    })
    commitPlan(
      (draft) => ({
        ...draft,
        assets: [...draft.assets, { ...asset, color: '#82906b' }],
      }),
      { type: 'asset', id: asset.id },
    )
  }, [commitPlan])

  const deleteSelection = useCallback(() => {
    if (!selected || selected.type === 'floor') {
      return
    }
    commitPlan(
      (draft) => ({
        ...draft,
        walls: selected.type === 'wall' ? draft.walls.filter((wall) => wall.id !== selected.id) : draft.walls,
        openings:
          selected.type === 'opening'
            ? draft.openings.filter((opening) => opening.id !== selected.id)
            : selected.type === 'wall'
              ? draft.openings.filter((opening) => opening.wallId !== selected.id)
              : draft.openings,
        assets: selected.type === 'asset' ? draft.assets.filter((asset) => asset.id !== selected.id) : draft.assets,
      }),
      null,
    )
  }, [commitPlan, selected])

  const duplicateSelection = useCallback(() => {
    if (selected?.type !== 'asset') {
      return
    }
    const asset = plan.assets.find((item) => item.id === selected.id)
    if (!asset) {
      return
    }
    const duplicate = {
      ...asset,
      id: makeId('asset'),
      name: `${asset.name} 복사`,
      x: asset.x + 24,
      y: asset.y + 24,
    }
    commitPlan(
      (draft) => ({
        ...draft,
        assets: [...draft.assets, duplicate],
      }),
      { type: 'asset', id: duplicate.id },
    )
  }, [commitPlan, plan.assets, selected])

  const rotateSelection = useCallback(() => {
    if (selected?.type !== 'asset') {
      return
    }
    commitPlan((draft) => ({
      ...draft,
      assets: draft.assets.map((asset) =>
        asset.id === selected.id
          ? { ...asset, rotationDeg: (asset.rotationDeg + 15) % 360 }
          : asset,
      ),
    }))
  }, [commitPlan, selected])

  const nudgeSelection = useCallback((xCm: number, yCm: number) => {
    if (selected?.type === 'asset') {
      commitPlan((draft) => ({
        ...draft,
        assets: draft.assets.map((asset) =>
          asset.id === selected.id
            ? { ...asset, x: asset.x + xCm, y: asset.y + yCm }
            : asset,
        ),
      }))
      return
    }

    if (selected?.type === 'opening' && xCm !== 0) {
      commitPlan((draft) => ({
        ...draft,
        openings: draft.openings.map((opening) => {
          if (opening.id !== selected.id) {
            return opening
          }
          const wall = draft.walls.find((item) => item.id === opening.wallId)
          if (!wall) {
            return opening
          }
          return {
            ...opening,
            offsetCm: clamp(
              opening.offsetCm + xCm,
              opening.widthCm / 2,
              Math.max(opening.widthCm / 2, wallLength(wall) - opening.widthCm / 2),
            ),
          }
        }),
      }))
    }
  }, [commitPlan, selected])

  const fitView = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }
    const drawingBounds = planBounds(plan)
    const width = Math.max(1, drawingBounds.maxX - drawingBounds.minX)
    const height = Math.max(1, drawingBounds.maxY - drawingBounds.minY)
    const zoom = clamp(Math.min((bounds.width - 80) / (width + 120), (bounds.height - 80) / (height + 120)), 0.35, 2.1)
    setViewport({
      zoom,
      pan: {
        x: bounds.width / 2 - ((drawingBounds.minX + drawingBounds.maxX) / 2) * zoom,
        y: bounds.height / 2 - ((drawingBounds.minY + drawingBounds.maxY) / 2) * zoom,
      },
    })
  }, [plan])

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || event.detail > 1) {
      return
    }

    const rawPoint = screenToWorld(event.clientX, event.clientY)
    const snappedPoint = snapWorldPoint(rawPoint, plan, drawPoints, event.shiftKey)

    if (effectiveTool === 'wall') {
      addWallPoint(snappedPoint)
      return
    }

    if (effectiveTool === 'rectangle') {
      createRectangleRoom()
      setTool('select')
      return
    }

    if (effectiveTool === 'structure') {
      drawStructure()
      setTool('select')
      return
    }

    if (effectiveTool === 'door' || effectiveTool === 'window') {
      placeOpening(effectiveTool, snappedPoint)
      return
    }

    if (effectiveTool === 'furniture') {
      placeFurniture(snappedPoint)
      return
    }

    if (effectiveTool === 'pan') {
      setDrag({
        type: 'pan',
        startScreen: clientToCanvas(event.clientX, event.clientY),
        startPan: viewport.pan,
        moved: false,
      })
      return
    }

    setSelected(null)
  }

  const handleCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rawPoint = screenToWorld(event.clientX, event.clientY)
    const snappedPoint = snapWorldPoint(rawPoint, plan, drawPoints, event.shiftKey)

    if (effectiveTool === 'wall') {
      setHoverPoint(snappedPoint)
      const lastPoint = drawPoints.at(-1)
      if (lastPoint && wallLengthInputRef.current !== document.activeElement) {
        setDraftLengthCm(String(roundCm(distance(lastPoint, snappedPoint))))
      }
    }

    if (!drag) {
      return
    }

    if (drag.type === 'pan') {
      const nextScreen = clientToCanvas(event.clientX, event.clientY)
      setViewport((current) => ({
        ...current,
        pan: {
          x: drag.startPan.x + nextScreen.x - drag.startScreen.x,
          y: drag.startPan.y + nextScreen.y - drag.startScreen.y,
        },
      }))
      setDrag({ ...drag, moved: true })
      return
    }

    if (drag.type === 'endpoint') {
      const wall = drag.base.walls.find((item) => item.id === drag.wallId)
      if (!wall) {
        return
      }
      const oldPoint = drag.endpoint === 'start' ? wall.start : wall.end
      replaceLivePlan(updateConnectedPoint(clonePlan(drag.base), oldPoint, snappedPoint))
      setDrag({ ...drag, moved: true })
      return
    }

    if (drag.type === 'wall') {
      const wall = drag.base.walls.find((item) => item.id === drag.wallId)
      if (!wall) {
        return
      }
      const delta = {
        x: rawPoint.x - drag.startWorld.x,
        y: rawPoint.y - drag.startWorld.y,
      }
      let nextPlan = clonePlan(drag.base)
      nextPlan = updateConnectedPoint(nextPlan, wall.start, { x: wall.start.x + delta.x, y: wall.start.y + delta.y })
      nextPlan = updateConnectedPoint(nextPlan, wall.end, { x: wall.end.x + delta.x, y: wall.end.y + delta.y })
      replaceLivePlan(nextPlan)
      setDrag({ ...drag, moved: true })
      return
    }

    if (drag.type === 'opening') {
      const opening = drag.base.openings.find((item) => item.id === drag.openingId)
      const nearestWall = findNearestWall(drag.base, rawPoint)
      if (!opening || !nearestWall) {
        return
      }
      replaceLivePlan({
        ...drag.base,
        openings: drag.base.openings.map((item) =>
          item.id === opening.id
            ? {
                ...item,
                wallId: nearestWall.wall.id,
                offsetCm: clamp(
                  nearestWall.offsetCm,
                  item.widthCm / 2,
                  Math.max(item.widthCm / 2, wallLength(nearestWall.wall) - item.widthCm / 2),
                ),
              }
            : item,
        ),
      })
      setDrag({ ...drag, moved: true })
      return
    }

    const asset = drag.base.assets.find((item) => item.id === drag.assetId)
    if (!asset) {
      return
    }
    replaceLivePlan({
      ...drag.base,
      assets: drag.base.assets.map((item) =>
        item.id === asset.id
          ? {
              ...item,
              x: snappedPoint.x - drag.offset.x,
              y: snappedPoint.y - drag.offset.y,
            }
          : item,
      ),
    })
    setDrag({ ...drag, moved: true })
  }

  const handleCanvasPointerUp = () => {
    if (drag && drag.type !== 'pan' && drag.moved) {
      setHistory((current) => ({
        plan: current.plan,
        past: [...current.past, drag.base].slice(-80),
        future: [],
      }))
    }
    setDrag(null)
  }

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const canvasPoint = clientToCanvas(event.clientX, event.clientY)
    const before = screenToWorld(event.clientX, event.clientY)
    const zoom = clamp(viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.35, 2.8)
    setViewport({
      zoom,
      pan: {
        x: canvasPoint.x - before.x * zoom,
        y: canvasPoint.y - before.y * zoom,
      },
    })
  }

  const handleDrop = (event: DragEvent<SVGSVGElement>) => {
    event.preventDefault()
    const openingType = event.dataTransfer.getData('application/deulim-opening') as OpeningType
    const assetType = event.dataTransfer.getData('application/deulim-asset')
    const point = screenToWorld(event.clientX, event.clientY)

    if (openingType === 'door' || openingType === 'window') {
      placeOpening(openingType, point)
      return
    }

    if (assetType === 'box') {
      placeFurniture(point)
    }
  }

  const handleOpeningDragStart = (event: DragEvent<HTMLButtonElement>, openingType: OpeningType) => {
    event.dataTransfer.setData('application/deulim-opening', openingType)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const handleAssetDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/deulim-asset', 'box')
    event.dataTransfer.effectAllowed = 'copy'
  }

  const savePlan = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
    setSavedAt(new Date().toLocaleTimeString('ko-KR'))
  }, [plan])

  const resetPlan = () => {
    commitPlan(() => clonePlan(emptyPlan), null)
    setDrawPoints([])
    setHoverPoint(null)
    setDraftLengthCm('')
  }

  const openCommandPalette = useCallback(() => {
    setCommandQuery('')
    setCommandIndex(0)
    setCommandOpen(true)
  }, [])

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false)
    setCommandQuery('')
    setCommandIndex(0)
  }, [])

  const commandItems: CommandItem[] = [
    { id: 'select', label: '선택 도구', shortcut: 'V' },
    { id: 'wall', label: '벽 그리기', shortcut: 'L' },
    { id: 'door', label: '문 추가', shortcut: 'D' },
    { id: 'window', label: '창문 추가', shortcut: 'N' },
    { id: 'furniture', label: '가구 배치', shortcut: 'B' },
    { id: 'pan', label: '화면 이동', shortcut: 'H' },
    { id: 'fit', label: '2D 화면 맞춤', shortcut: 'F' },
    { id: 'undo', label: '실행 취소', shortcut: 'Ctrl Z', disabled: history.past.length === 0 },
    { id: 'redo', label: '다시 실행', shortcut: 'Ctrl Y', disabled: history.future.length === 0 },
    { id: 'rotate', label: '선택 가구 회전', shortcut: 'R', disabled: selected?.type !== 'asset' },
    { id: 'duplicate', label: '선택 가구 복제', shortcut: 'Ctrl D', disabled: selected?.type !== 'asset' },
    { id: 'delete', label: '선택 객체 삭제', shortcut: 'Delete', disabled: !selected || selected.type === 'floor' },
    { id: 'save', label: '도면 저장', shortcut: 'Ctrl S' },
  ]

  const filteredCommands = commandItems.filter((item) =>
    item.label.toLocaleLowerCase('ko-KR').includes(commandQuery.trim().toLocaleLowerCase('ko-KR')),
  )

  const runCommand = (item: CommandItem) => {
    if (item.disabled) {
      return
    }
    const toolCommands: Partial<Record<string, Tool>> = {
      select: 'select',
      wall: 'wall',
      door: 'door',
      window: 'window',
      furniture: 'furniture',
      pan: 'pan',
    }
    if (toolCommands[item.id]) {
      setTool(toolCommands[item.id]!)
    } else if (item.id === 'fit') {
      fitView()
    } else if (item.id === 'undo') {
      undo()
    } else if (item.id === 'redo') {
      redo()
    } else if (item.id === 'rotate') {
      rotateSelection()
    } else if (item.id === 'duplicate') {
      duplicateSelection()
    } else if (item.id === 'delete') {
      deleteSelection()
    } else if (item.id === 'save') {
      savePlan()
    }
    closeCommandPalette()
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable

      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault()
        openCommandPalette()
        return
      }
      if (event.key === '?' && !isEditing) {
        event.preventDefault()
        openCommandPalette()
        return
      }
      if (event.key === 'Escape') {
        if (commandOpen) {
          closeCommandPalette()
          return
        }
        setDrawPoints([])
        setHoverPoint(null)
        setDraftLengthCm('')
        setDrag(null)
        setSpacePan(false)
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        savePlan()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'd' && !isEditing) {
        event.preventDefault()
        duplicateSelection()
        return
      }
      if (isEditing || commandOpen) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        setSpacePan(true)
        return
      }
      if (tool === 'wall' && drawPoints.length > 0 && /^[0-9.]$/.test(event.key)) {
        event.preventDefault()
        setDraftLengthCm(event.key)
        requestAnimationFrame(() => wallLengthInputRef.current?.focus())
        return
      }
      if (event.key === 'Enter' && drawPoints.length > 1) {
        finishOpenWallDrawing()
        return
      }
      if (event.key === 'Backspace' && drawPoints.length > 0) {
        event.preventDefault()
        setDrawPoints((current) => current.slice(0, -1))
        setHoverPoint(drawPoints.length > 1 ? drawPoints.at(-2) ?? null : null)
        setDraftLengthCm('')
        return
      }
      if (event.key.startsWith('Arrow') && selected) {
        const step = event.shiftKey ? 10 : 1
        const movement = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key]
        if (movement) {
          event.preventDefault()
          nudgeSelection(movement[0], movement[1])
          return
        }
      }
      const toolShortcut: Partial<Record<string, Tool>> = {
        v: 'select',
        l: 'wall',
        d: 'door',
        n: 'window',
        b: 'furniture',
        m: 'measure',
        h: 'pan',
      }
      if (toolShortcut[key]) {
        event.preventDefault()
        setTool(toolShortcut[key]!)
        return
      }
      if (key === 'f') {
        event.preventDefault()
        fitView()
        return
      }
      if (key === 'r' && selected?.type === 'asset') {
        event.preventDefault()
        rotateSelection()
        return
      }
      if (!isEditing && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        deleteSelection()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePan(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [closeCommandPalette, commandOpen, deleteSelection, drawPoints, duplicateSelection, finishOpenWallDrawing, fitView, nudgeSelection, openCommandPalette, redo, rotateSelection, savePlan, selected, tool, undo])

  const selectedLabel =
    selectedWall
      ? '벽'
      : selectedOpening
        ? selectedOpening.type === 'door'
          ? '문'
          : '창문'
        : selectedAsset
          ? selectedAsset.name
          : selectedFloor
            ? '바닥'
          : '없음'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Deulim CAD</p>
          <h1>직접 그리는 실측 공간 편집기</h1>
        </div>
        <div className="topbar-actions">
          <span className="autosave-status">{savedAt ? `저장 ${savedAt}` : '자동 저장'}</span>
          <button
            type="button"
            className="command-trigger"
            onClick={openCommandPalette}
            aria-label="명령 팔레트"
            title="명령 팔레트 (Ctrl+K)"
            data-testid="command-trigger"
          >
            <Search size={16} />
            <span>명령</span>
          </button>
          <button type="button" className="icon-button" onClick={undo} disabled={history.past.length === 0} aria-label="실행 취소">
            <Undo2 size={18} />
          </button>
          <button type="button" className="icon-button" onClick={redo} disabled={history.future.length === 0} aria-label="다시 실행">
            <Redo2 size={18} />
          </button>
          <button type="button" className="action-button" onClick={savePlan} data-testid="save-button">
            <Save size={17} />
            저장
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="tool-rail" aria-label="도면 도구">
          {toolItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                key={item.id}
                className={`tool-button ${tool === item.id ? 'active' : ''}`}
                onClick={() => setTool(item.id)}
                aria-label={item.label}
                title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                data-testid={`tool-${item.id}`}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            )
          })}
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div className="status-row">
              <span className="active-tool-pill">
                {toolItems.find((item) => item.id === tool)?.label}
              </span>
              <span data-testid="wall-count">벽 {plan.walls.length}</span>
              <span data-testid="opening-count">문/창 {plan.openings.length}</span>
              <span data-testid="asset-count">가구 {plan.assets.length}</span>
              <span data-testid="closed-room-status">{polygon ? '닫힌 방: 생성됨' : '닫힌 방: 편집 중'}</span>
              {drawPoints.length > 0 && (
                <span data-testid="drawing-status">그리는 중 {drawPoints.length}점</span>
              )}
            </div>
            <div className="canvas-actions">
              <button
                type="button"
                className="delete-command"
                onClick={deleteSelection}
                disabled={!selected || selected.type === 'floor'}
                data-testid="delete-selection"
              >
                <Trash2 size={16} /> 선택 삭제
              </button>
              <button type="button" className="icon-button" onClick={() => setViewport((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, 0.35, 2.8) }))} aria-label="확대">
                <ZoomIn size={17} />
              </button>
              <button type="button" className="icon-button" onClick={() => setViewport((current) => ({ ...current, zoom: clamp(current.zoom / 1.15, 0.35, 2.8) }))} aria-label="축소">
                <ZoomOut size={17} />
              </button>
              <button type="button" className="icon-button" onClick={fitView} aria-label="화면 맞춤">
                <Maximize size={17} />
              </button>
              <span className="grid-pill"><Grid3X3 size={15} /> {GRID_CM}cm</span>
            </div>
          </div>

          {tool === 'wall' && drawPoints.length > 0 && (
            <form
              className="precision-hud"
              data-testid="precision-hud"
              onSubmit={(event) => {
                event.preventDefault()
                commitExactWallLength()
              }}
            >
              <label htmlFor="draft-wall-length">벽 길이</label>
              <div className="precision-input-wrap">
                <input
                  ref={wallLengthInputRef}
                  id="draft-wall-length"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="decimal"
                  value={draftLengthCm}
                  onChange={(event) => setDraftLengthCm(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="draft-wall-length"
                  aria-label="그릴 벽 길이"
                />
                <span>cm</span>
              </div>
              <button type="submit" aria-label="정확한 길이 적용" title="정확한 길이 적용">
                <Check size={16} />
              </button>
            </form>
          )}

          <svg
            ref={canvasRef}
            className={`cad-canvas tool-${effectiveTool}`}
            data-testid="cad-canvas"
            data-effective-tool={effectiveTool}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
            onDoubleClick={finishOpenWallDrawing}
            onWheel={handleWheel}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            role="application"
            aria-label="2D 도면 캔버스"
          >
            <defs>
              <pattern id="small-grid" width={GRID_CM} height={GRID_CM} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID_CM} 0 L 0 0 0 ${GRID_CM}`} fill="none" stroke="#e5e1d6" strokeWidth="0.5" />
              </pattern>
              <pattern id="big-grid" width={GRID_CM * 5} height={GRID_CM * 5} patternUnits="userSpaceOnUse">
                <rect width={GRID_CM * 5} height={GRID_CM * 5} fill="url(#small-grid)" />
                <path d={`M ${GRID_CM * 5} 0 L 0 0 0 ${GRID_CM * 5}`} fill="none" stroke="#c8d1c4" strokeWidth="1" />
              </pattern>
            </defs>
            <g transform={`translate(${viewport.pan.x} ${viewport.pan.y}) scale(${viewport.zoom})`}>
              <rect x="-2000" y="-2000" width="5000" height="5000" fill="url(#big-grid)" className="grid-base" />

              {polygon && (
                <>
                  <path
                    d={`${makePath(polygon)} Z`}
                    className={`room-floor ${selectedFloor ? 'selected' : ''}`}
                    data-testid="floor-polygon"
                    onPointerDown={(event) => {
                      if (effectiveTool === 'select') {
                        event.stopPropagation()
                        setSelected({ type: 'floor' })
                      }
                    }}
                  />
                  {floorLabelPoint && (
                    <text
                      x={floorLabelPoint.x}
                      y={floorLabelPoint.y}
                      className={`floor-label ${selectedFloor ? 'selected' : ''}`}
                      onPointerDown={(event) => {
                        if (effectiveTool === 'select') {
                          event.stopPropagation()
                          setSelected({ type: 'floor' })
                        }
                      }}
                    >
                      바닥 {plan.floor.elevationCm >= 0 ? '+' : ''}{roundCm(plan.floor.elevationCm)}cm
                    </text>
                  )}
                </>
              )}

              {plan.walls.map((wall) => {
                const isSelected = selected?.type === 'wall' && selected.id === wall.id
                const mid = midpoint(wall.start, wall.end)
                return (
                  <g key={wall.id} className="wall-group">
                    <line
                      x1={wall.start.x}
                      y1={wall.start.y}
                      x2={wall.end.x}
                      y2={wall.end.y}
                      className={`wall-line ${isSelected ? 'selected' : ''}`}
                      strokeWidth={wall.thicknessCm}
                      onPointerDown={(event) => {
                        if (effectiveTool === 'pan') {
                          return
                        }
                        event.stopPropagation()
                        if (effectiveTool === 'door' || effectiveTool === 'window') {
                          placeOpening(effectiveTool, screenToWorld(event.clientX, event.clientY))
                          return
                        }
                        setSelected({ type: 'wall', id: wall.id })
                        if (effectiveTool === 'select') {
                          setDrag({
                            type: 'wall',
                            wallId: wall.id,
                            base: clonePlan(plan),
                            startWorld: screenToWorld(event.clientX, event.clientY),
                            moved: false,
                          })
                        }
                      }}
                    />
                    <text
                      x={mid.x}
                      y={mid.y - 14}
                      className={`dimension-label ${isSelected ? 'selected' : ''}`}
                      transform={`rotate(${angleDeg(wall.start, wall.end)} ${mid.x} ${mid.y - 14})`}
                      onPointerDown={(event) => {
                        if (effectiveTool === 'pan') {
                          return
                        }
                        event.stopPropagation()
                        setSelected({ type: 'wall', id: wall.id })
                      }}
                    >
                      {roundCm(wallLength(wall))}cm
                    </text>
                    {isSelected && (
                      <>
                        <circle
                          cx={wall.start.x}
                          cy={wall.start.y}
                          r={8 / viewport.zoom}
                          className="endpoint-handle"
                          onPointerDown={(event) => {
                            if (effectiveTool === 'pan') {
                              return
                            }
                            event.stopPropagation()
                            setDrag({
                              type: 'endpoint',
                              wallId: wall.id,
                              endpoint: 'start',
                              base: clonePlan(plan),
                              moved: false,
                            })
                          }}
                        />
                        <circle
                          cx={wall.end.x}
                          cy={wall.end.y}
                          r={8 / viewport.zoom}
                          className="endpoint-handle"
                          onPointerDown={(event) => {
                            if (effectiveTool === 'pan') {
                              return
                            }
                            event.stopPropagation()
                            setDrag({
                              type: 'endpoint',
                              wallId: wall.id,
                              endpoint: 'end',
                              base: clonePlan(plan),
                              moved: false,
                            })
                          }}
                        />
                      </>
                    )}
                  </g>
                )
              })}

              {plan.openings.map((opening) => {
                const placement = openingPlacement(plan, opening)
                if (!placement) {
                  return null
                }
                const selectedOpeningId = selected?.type === 'opening' && selected.id === opening.id
                return (
                  <g
                    key={opening.id}
                    transform={`translate(${placement.point.x} ${placement.point.y}) rotate(${placement.angle})`}
                    className={`opening ${opening.type} ${selectedOpeningId ? 'selected' : ''}`}
                    onPointerDown={(event) => {
                      if (effectiveTool === 'pan') {
                        return
                      }
                      event.stopPropagation()
                      setSelected({ type: 'opening', id: opening.id })
                      if (effectiveTool === 'select') {
                        setDrag({
                          type: 'opening',
                          openingId: opening.id,
                          base: clonePlan(plan),
                          moved: false,
                        })
                      }
                    }}
                  >
                    <rect x={-opening.widthCm / 2} y={-10} width={opening.widthCm} height={20} rx={2} />
                    {opening.type === 'door' && (
                      <path d={`M ${-opening.widthCm / 2} 0 A ${opening.widthCm} ${opening.widthCm} 0 0 1 ${opening.widthCm / 2} ${-opening.widthCm}`} className="door-swing" />
                    )}
                  </g>
                )
              })}

              {plan.assets.map((asset) => {
                const assetSelected = selected?.type === 'asset' && selected.id === asset.id
                return (
                  <g
                    key={asset.id}
                    transform={`translate(${asset.x} ${asset.y}) rotate(${asset.rotationDeg})`}
                    className={`asset ${assetSelected ? 'selected' : ''}`}
                    data-testid="asset-item"
                    data-x={asset.x}
                    data-y={asset.y}
                    data-rotation={asset.rotationDeg}
                    onPointerDown={(event) => {
                      if (effectiveTool === 'pan') {
                        return
                      }
                      event.stopPropagation()
                      setSelected({ type: 'asset', id: asset.id })
                      if (effectiveTool === 'select' || effectiveTool === 'furniture') {
                        const worldPoint = screenToWorld(event.clientX, event.clientY)
                        setDrag({
                          type: 'asset',
                          assetId: asset.id,
                          base: clonePlan(plan),
                          offset: { x: worldPoint.x - asset.x, y: worldPoint.y - asset.y },
                          moved: false,
                        })
                      }
                    }}
                  >
                    <rect
                      x={-asset.widthCm / 2}
                      y={-asset.depthCm / 2}
                      width={asset.widthCm}
                      height={asset.depthCm}
                      rx={3}
                      fill={asset.color}
                    />
                    <text y={4} className="asset-label">{asset.name}</text>
                  </g>
                )
              })}

              {drawPoints.length > 0 && (
                <g className="drawing-preview">
                  {drawPoints.map((point, index) => (
                    <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={5 / viewport.zoom} />
                  ))}
                  <polyline
                    points={[
                      ...drawPoints,
                      ...(hoverPoint ? [hoverPoint] : []),
                    ]
                      .map((point) => `${point.x},${point.y}`)
                      .join(' ')}
                  />
                  {hoverPoint && drawPoints.at(-1) && (
                    <text
                      x={(drawPoints.at(-1)!.x + hoverPoint.x) / 2}
                      y={(drawPoints.at(-1)!.y + hoverPoint.y) / 2 - 12}
                      className="live-length"
                    >
                      {roundCm(distance(drawPoints.at(-1)!, hoverPoint))}cm
                    </text>
                  )}
                </g>
              )}
            </g>
          </svg>
        </section>

        <ThreePreview
          plan={plan}
          selected={selected}
          polygon={polygon}
          warnings={warnings}
          onSelect={setSelected}
        />
      </section>

      <section className="control-deck side-panel">
          <section className="panel-section">
            <div className="panel-title">
              <span>선택</span>
              <strong data-testid="selection-label">{selectedLabel}</strong>
            </div>
            <div className="compact-actions">
              <button type="button" className="compact-command" onClick={rotateSelection} disabled={selected?.type !== 'asset'} aria-label="회전">
                <RotateCw size={16} /> 회전
              </button>
              <button type="button" className="compact-command" onClick={duplicateSelection} disabled={selected?.type !== 'asset'} aria-label="복제">
                <Copy size={16} /> 복제
              </button>
              <button type="button" className="compact-command danger" onClick={deleteSelection} disabled={!selected || selected.type === 'floor'} aria-label="삭제">
                <Trash2 size={16} /> 삭제
              </button>
            </div>
          </section>

          <section className="panel-section" data-testid="floor-inspector">
            <div className="panel-title">
              <span><Layers3 size={15} /> 현재 방 바닥</span>
              <strong>{plan.floor.elevationCm >= 0 ? '+' : ''}{roundCm(plan.floor.elevationCm)}cm</strong>
            </div>
            <div className="dimension-triplet floor-dimensions">
              <label>
                기준 높이 cm
                <input
                  type="number"
                  data-testid="floor-elevation-input"
                  value={roundCm(plan.floor.elevationCm)}
                  onFocus={() => setSelected({ type: 'floor' })}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => ({
                        ...draft,
                        floor: { ...draft.floor, elevationCm: value },
                      }), { type: 'floor' })
                    }
                  }}
                />
              </label>
              <label>
                슬래브 두께 cm
                <input
                  type="number"
                  data-testid="floor-thickness-input"
                  min="1"
                  value={roundCm(plan.floor.thicknessCm)}
                  onFocus={() => setSelected({ type: 'floor' })}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => ({
                        ...draft,
                        floor: { ...draft.floor, thicknessCm: Math.max(1, value) },
                      }), { type: 'floor' })
                    }
                  }}
                />
              </label>
            </div>
          </section>

          {selectedWall && (
            <section className="panel-section" data-testid="wall-inspector">
              <label>
                실제 길이 cm
                <input
                  type="number"
                  data-testid="wall-length-input"
                  value={roundCm(wallLength(selectedWall))}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => updateWallLengthInPlan(draft, selectedWall.id, value))
                    }
                  }}
                />
              </label>
              <label>
                벽 두께 cm
                <input
                  type="number"
                  value={roundCm(selectedWall.thicknessCm)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => updateWallNumeric(draft, selectedWall.id, 'thicknessCm', value))
                    }
                  }}
                />
              </label>
              <label>
                벽 높이 cm
                <input
                  type="number"
                  value={roundCm(selectedWall.heightCm)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => updateWallNumeric(draft, selectedWall.id, 'heightCm', value))
                    }
                  }}
                />
              </label>
            </section>
          )}

          {selectedOpening && (
            <section className="panel-section">
              <label>
                너비 cm
                <input
                  type="number"
                  value={roundCm(selectedOpening.widthCm)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => ({
                        ...draft,
                        openings: draft.openings.map((opening) =>
                          opening.id === selectedOpening.id ? { ...opening, widthCm: value } : opening,
                        ),
                      }))
                    }
                  }}
                />
              </label>
              <label>
                높이 cm
                <input
                  type="number"
                  value={roundCm(selectedOpening.heightCm)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => ({
                        ...draft,
                        openings: draft.openings.map((opening) =>
                          opening.id === selectedOpening.id ? { ...opening, heightCm: value } : opening,
                        ),
                      }))
                    }
                  }}
                />
              </label>
              <label>
                바닥 기준 cm
                <input
                  type="number"
                  value={roundCm(selectedOpening.sillHeightCm)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      commitPlan((draft) => ({
                        ...draft,
                        openings: draft.openings.map((opening) =>
                          opening.id === selectedOpening.id ? { ...opening, sillHeightCm: value } : opening,
                        ),
                      }))
                    }
                  }}
                />
              </label>
            </section>
          )}

          {selectedAsset && (
            <section className="panel-section">
              <label>
                이름
                <input
                  value={selectedAsset.name}
                  onChange={(event) => {
                    const value = event.target.value
                    commitPlan((draft) => ({
                      ...draft,
                      assets: draft.assets.map((asset) =>
                        asset.id === selectedAsset.id ? { ...asset, name: value } : asset,
                      ),
                    }))
                  }}
                />
              </label>
              <div className="dimension-triplet">
                <label>
                  가로
                  <input
                    type="number"
                    value={selectedAsset.widthCm}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        commitPlan((draft) => ({
                          ...draft,
                          assets: draft.assets.map((asset) =>
                            asset.id === selectedAsset.id ? { ...asset, widthCm: value } : asset,
                          ),
                        }))
                      }
                    }}
                  />
                </label>
                <label>
                  깊이
                  <input
                    type="number"
                    value={selectedAsset.depthCm}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        commitPlan((draft) => ({
                          ...draft,
                          assets: draft.assets.map((asset) =>
                            asset.id === selectedAsset.id ? { ...asset, depthCm: value } : asset,
                          ),
                        }))
                      }
                    }}
                  />
                </label>
                <label>
                  높이
                  <input
                    type="number"
                    value={selectedAsset.heightCm}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        commitPlan((draft) => ({
                          ...draft,
                          assets: draft.assets.map((asset) =>
                            asset.id === selectedAsset.id ? { ...asset, heightCm: value } : asset,
                          ),
                        }))
                      }
                    }}
                  />
                </label>
              </div>
            </section>
          )}

          <section className="panel-section">
            <div className="panel-title">
              <span>배치 팔레트</span>
            </div>
            <div className="palette-row">
              <button
                type="button"
                draggable
                className="drag-chip door-chip"
                data-testid="door-chip"
                onDragStart={(event) => handleOpeningDragStart(event, 'door')}
                onClick={() => setTool('door')}
              >
                <DoorOpen size={16} /> 문
              </button>
              <button
                type="button"
                draggable
                className="drag-chip window-chip"
                data-testid="window-chip"
                onDragStart={(event) => handleOpeningDragStart(event, 'window')}
                onClick={() => setTool('window')}
              >
                <AppWindow size={16} /> 창문
              </button>
              <button
                type="button"
                draggable
                className="drag-chip asset-chip"
                data-testid="asset-chip"
                onDragStart={handleAssetDragStart}
                onClick={() => setTool('furniture')}
              >
                <Box size={16} /> 물체
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="panel-title">
              <span>기본 물체</span>
            </div>
            <label>
              이름
              <input
                value={furnitureDraft.name}
                onChange={(event) => setFurnitureDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="dimension-triplet">
              <label>
                가로
                <input
                  type="number"
                  value={furnitureDraft.widthCm}
                  onChange={(event) => setFurnitureDraft((current) => ({ ...current, widthCm: Number(event.target.value) || 1 }))}
                />
              </label>
              <label>
                깊이
                <input
                  type="number"
                  value={furnitureDraft.depthCm}
                  onChange={(event) => setFurnitureDraft((current) => ({ ...current, depthCm: Number(event.target.value) || 1 }))}
                />
              </label>
              <label>
                높이
                <input
                  type="number"
                  value={furnitureDraft.heightCm}
                  onChange={(event) => setFurnitureDraft((current) => ({ ...current, heightCm: Number(event.target.value) || 1 }))}
                />
              </label>
            </div>
            <button
              type="button"
              className="action-button full"
              data-testid="furniture-tool"
              onClick={() => setTool('furniture')}
            >
              <Box size={17} />
              캔버스에 배치
            </button>
          </section>

          <section className="panel-section warnings">
            <div className="panel-title">
              <span>검사</span>
              <strong>{warnings.length === 0 ? '정상' : `${warnings.length}개`}</strong>
            </div>
            {warnings.length === 0 ? (
              <p>닫힌 영역과 배치가 현재 기준을 통과했습니다.</p>
            ) : (
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-section utility">
            <button type="button" className="ghost-button" onClick={createRectangleRoom}>직사각형 빠른 시작</button>
            <button type="button" className="ghost-button" onClick={resetPlan}>도면 비우기</button>
            {savedAt && <p className="saved-at">마지막 저장 {savedAt}</p>}
          </section>
      </section>

      {commandOpen && (
        <div
          className="command-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCommandPalette()
            }
          }}
        >
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="명령 팔레트">
            <header className="command-header">
              <Command size={18} />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => {
                  setCommandQuery(event.target.value)
                  setCommandIndex(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setCommandIndex((current) => Math.min(current + 1, Math.max(0, filteredCommands.length - 1)))
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setCommandIndex((current) => Math.max(current - 1, 0))
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    const command = filteredCommands[commandIndex]
                    if (command) {
                      runCommand(command)
                    }
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    closeCommandPalette()
                  }
                }}
                placeholder="명령 검색"
                aria-label="명령 검색"
                data-testid="command-search"
              />
              <button type="button" className="icon-button" onClick={closeCommandPalette} aria-label="명령 팔레트 닫기">
                <X size={17} />
              </button>
            </header>
            <div className="command-list" role="listbox">
              {filteredCommands.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={index === commandIndex ? 'active' : ''}
                  disabled={item.disabled}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(item)}
                  role="option"
                  aria-selected={index === commandIndex}
                  data-testid={`command-${item.id}`}
                >
                  <span>{item.label}</span>
                  <kbd>{item.shortcut}</kbd>
                </button>
              ))}
              {filteredCommands.length === 0 && <p className="command-empty">일치하는 명령 없음</p>}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function frameThreeCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  plan: FloorPlan,
  viewMode: ThreeViewMode,
) {
  const bounds = planBounds(plan)
  const centerX = ((bounds.minX + bounds.maxX) / 2) * CM_TO_M
  const centerZ = ((bounds.minY + bounds.maxY) / 2) * CM_TO_M
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 200) * CM_TO_M
  const floorElevationM = plan.floor.elevationCm * CM_TO_M

  if (viewMode === 'top') {
    camera.position.set(centerX, floorElevationM + Math.max(6, span * 2.1), centerZ + 0.001)
    controls.enableRotate = false
  } else if (viewMode === 'eye') {
    camera.position.set(centerX - span * 0.35, floorElevationM + 1.62, centerZ + span * 0.58)
    controls.enableRotate = true
  } else {
    camera.position.set(
      centerX + span * 0.9,
      floorElevationM + Math.max(2.6, span * 0.85),
      centerZ + span * 1.05,
    )
    controls.enableRotate = true
  }

  controls.target.set(centerX, floorElevationM + (viewMode === 'eye' ? 1.35 : 0.7), centerZ)
  controls.update()
}

function ThreePreview({
  plan,
  selected,
  polygon,
  warnings,
  onSelect,
}: {
  plan: FloorPlan
  selected: Selection
  polygon: Point[] | null
  warnings: string[]
  onSelect: (selection: Selection) => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const pointerDownRef = useRef<Point | null>(null)
  const hasFramedPlanRef = useRef(false)
  const planRef = useRef(plan)
  const onSelectRef = useRef(onSelect)
  const [viewMode, setViewMode] = useState<ThreeViewMode>('orbit')
  const [wallXRay, setWallXRay] = useState(true)
  const [cameraFitRequest, setCameraFitRequest] = useState(0)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    planRef.current = plan
  }, [plan])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return undefined
    }

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f7f4ec')

    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, 0.1, 100)
    camera.position.set(3.9, 3.1, 4.2)
    camera.lookAt(1.4, 0.6, 1.1)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.minDistance = 1.2
    controls.maxDistance = 18
    controls.maxPolarAngle = Math.PI / 2.05

    const syncCameraPose = () => {
      mount.dataset.cameraPose = [
        camera.position.x,
        camera.position.y,
        camera.position.z,
        controls.target.x,
        controls.target.y,
        controls.target.z,
      ].map((value) => value.toFixed(4)).join(',')
    }
    controls.addEventListener('change', syncCameraPose)

    const group = new THREE.Group()
    scene.add(group)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({
        color: '#e8dfd0',
        roughness: 0.9,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.015
    ground.receiveShadow = true
    scene.add(ground)

    const grid = new THREE.GridHelper(30, 60, '#b8afa2', '#d6cec1')
    grid.position.y = -0.01
    scene.add(grid)

    const ambient = new THREE.HemisphereLight('#ffffff', '#b8b1a4', 2.2)
    scene.add(ambient)

    const light = new THREE.DirectionalLight('#ffffff', 2.6)
    light.position.set(4, 7, 3)
    light.castShadow = true
    scene.add(light)

    const resizeObserver = new ResizeObserver(() => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    resizeObserver.observe(mount)

    const handleCanvasPointerDown = (event: PointerEvent) => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY }
    }
    const handleCanvasClick = (event: MouseEvent) => {
      const pointerDown = pointerDownRef.current
      pointerDownRef.current = null
      if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) {
        return
      }
      const bounds = renderer.domElement.getBoundingClientRect()
      pointerRef.current.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointerRef.current.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1)
      raycasterRef.current.setFromCamera(pointerRef.current, camera)
      const hits = raycasterRef.current.intersectObjects(group.children, true)
      const selection = hits
        .map((hit) => hit.object.userData.selection as Selection | undefined)
        .find(Boolean)
      onSelectRef.current(selection ?? null)
    }
    renderer.domElement.addEventListener('pointerdown', handleCanvasPointerDown)
    renderer.domElement.addEventListener('click', handleCanvasClick)

    let frameId = 0
    const renderLoop = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(renderLoop)
    }

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    groupRef.current = group
    controlsRef.current = controls
    syncCameraPose()
    renderLoop()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handleCanvasPointerDown)
      renderer.domElement.removeEventListener('click', handleCanvasClick)
      controls.removeEventListener('change', syncCameraPose)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    const group = groupRef.current
    const controls = controlsRef.current
    if (!renderer || !scene || !camera || !group || !controls) {
      return
    }

    for (const child of [...group.children]) {
      child.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return
        }
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      })
      group.remove(child)
    }

    const floorElevationM = plan.floor.elevationCm * CM_TO_M

    if (polygon) {
      const shape = new THREE.Shape()
      polygon.forEach((point, index) => {
        if (index === 0) {
          shape.moveTo(point.x * CM_TO_M, point.y * CM_TO_M)
        } else {
          shape.lineTo(point.x * CM_TO_M, point.y * CM_TO_M)
        }
      })
      const floorGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: plan.floor.thicknessCm * CM_TO_M,
        bevelEnabled: false,
      })
      const selectedFloor = selected?.type === 'floor'
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: selectedFloor ? '#c49a5b' : '#d9c7aa',
        emissive: selectedFloor ? '#3d2a12' : '#000000',
        emissiveIntensity: selectedFloor ? 0.18 : 0,
        roughness: 0.72,
        side: THREE.DoubleSide,
      })
      const floor = new THREE.Mesh(floorGeometry, floorMaterial)
      floor.rotation.x = Math.PI / 2
      floor.position.y = floorElevationM
      floor.receiveShadow = true
      floor.userData.selection = { type: 'floor' }
      group.add(floor)
    }

    for (const wall of plan.walls) {
      const lengthM = wallLength(wall) * CM_TO_M
      const thicknessM = wall.thicknessCm * CM_TO_M
      const heightM = wall.heightCm * CM_TO_M
      const geometry = new THREE.BoxGeometry(lengthM, heightM, thicknessM)
      const selectedWall = selected?.type === 'wall' && selected.id === wall.id
      const material = new THREE.MeshStandardMaterial({
        color: selectedWall ? '#486d8f' : '#f4efe5',
        roughness: 0.58,
        transparent: wallXRay,
        opacity: wallXRay ? (selectedWall ? 0.72 : 0.46) : 1,
        depthWrite: !wallXRay,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const mid = midpoint(wall.start, wall.end)
      mesh.position.set(mid.x * CM_TO_M, floorElevationM + heightM / 2, mid.y * CM_TO_M)
      mesh.rotation.y = -Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.selection = { type: 'wall', id: wall.id }
      group.add(mesh)
    }

    for (const opening of plan.openings) {
      const placement = openingPlacement(plan, opening)
      if (!placement) {
        continue
      }
      const geometry = new THREE.BoxGeometry(
        opening.widthCm * CM_TO_M,
        opening.heightCm * CM_TO_M,
        0.055,
      )
      const selectedOpening = selected?.type === 'opening' && selected.id === opening.id
      const material = new THREE.MeshStandardMaterial({
        color: opening.type === 'door' ? '#c56b4a' : '#579ab2',
        emissive: selectedOpening ? '#253b4e' : '#000000',
        emissiveIntensity: selectedOpening ? 0.4 : 0,
        transparent: true,
        opacity: opening.type === 'door' ? 0.86 : 0.72,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(
        placement.point.x * CM_TO_M,
        floorElevationM + (opening.sillHeightCm + opening.heightCm / 2) * CM_TO_M,
        placement.point.y * CM_TO_M,
      )
      mesh.rotation.y = -Math.atan2(placement.wall.end.y - placement.wall.start.y, placement.wall.end.x - placement.wall.start.x)
      mesh.userData.selection = { type: 'opening', id: opening.id }
      group.add(mesh)
    }

    for (const asset of plan.assets) {
      const geometry = new THREE.BoxGeometry(asset.widthCm * CM_TO_M, asset.heightCm * CM_TO_M, asset.depthCm * CM_TO_M)
      const selectedAsset = selected?.type === 'asset' && selected.id === asset.id
      const material = new THREE.MeshStandardMaterial({
        color: selectedAsset ? '#2f7f6f' : asset.color,
        roughness: 0.64,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(asset.x * CM_TO_M, floorElevationM + (asset.heightCm / 2) * CM_TO_M, asset.y * CM_TO_M)
      mesh.rotation.y = (-asset.rotationDeg * Math.PI) / 180
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.selection = { type: 'asset', id: asset.id }
      group.add(mesh)
    }

    if (!hasFramedPlanRef.current && plan.walls.length > 0) {
      frameThreeCamera(camera, controls, plan, viewMode)
      hasFramedPlanRef.current = true
    }
    renderer.render(scene, camera)
  }, [plan, polygon, selected, viewMode, wallXRay])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const mount = mountRef.current
    if (!camera || !controls || !mount) {
      return
    }
    frameThreeCamera(camera, controls, planRef.current, viewMode)
    mount.dataset.cameraPose = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      controls.target.x,
      controls.target.y,
      controls.target.z,
    ].map((value) => value.toFixed(4)).join(',')
  }, [cameraFitRequest, viewMode])

  return (
    <div className="three-shell">
      <div className="three-header">
        <div>
          <p className="eyebrow">3D Preview</p>
          <h2>2D 도면에서 즉시 생성</h2>
        </div>
        <div className="three-toolbar">
          {(['orbit', 'top', 'eye'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              className={`view-mode-button ${viewMode === mode ? 'active' : ''}`}
              onClick={() => setViewMode(mode)}
              data-testid={`view-${mode}`}
            >
              {mode === 'orbit' ? '입체' : mode === 'top' ? '평면' : '눈높이'}
            </button>
          ))}
          <button
            type="button"
            className={`view-mode-button xray-button ${wallXRay ? 'active' : ''}`}
            onClick={() => setWallXRay((current) => !current)}
            aria-label={wallXRay ? '벽 투시 끄기' : '벽 투시 켜기'}
            aria-pressed={wallXRay}
            title={wallXRay ? '벽 투시 끄기' : '벽 투시 켜기'}
            data-testid="wall-xray"
          >
            {wallXRay ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button
            type="button"
            className="view-mode-button"
            onClick={() => setCameraFitRequest((current) => current + 1)}
            data-testid="fit-three-view"
          >
            화면 맞춤
          </button>
          <span
            className={`scene-status ${polygon ? 'ready' : 'editing'}`}
            data-testid="three-status"
            data-wall-count={plan.walls.length}
            data-opening-count={plan.openings.length}
            data-asset-count={plan.assets.length}
            data-floor-elevation={plan.floor.elevationCm}
          >
            {polygon ? '3D 방 생성' : '편집 중'}
          </span>
        </div>
      </div>
      <div ref={mountRef} className="three-view" data-testid="three-view" />
      <div className="three-footer">
        <span>벽 {plan.walls.length}</span>
        <span>바닥 {plan.floor.elevationCm >= 0 ? '+' : ''}{roundCm(plan.floor.elevationCm)}cm · 두께 {roundCm(plan.floor.thicknessCm)}cm</span>
        <span>바닥 {polygon ? 1 : 0}</span>
        <span>경고 {warnings.length}</span>
      </div>
    </div>
  )
}

export default App
