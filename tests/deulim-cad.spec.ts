import { expect, test } from '@playwright/test'

async function clickCanvas(page: import('@playwright/test').Page, x: number, y: number) {
  const canvas = page.getByTestId('cad-canvas')
  const box = await canvas.boundingBox()
  if (!box) {
    throw new Error('CAD canvas was not visible')
  }
  await page.mouse.click(box.x + x, box.y + y)
}

async function expectThreeCanvasSignal(page: import('@playwright/test').Page) {
  const signal = await page.getByTestId('three-view').locator('canvas').evaluate((source) => {
    const canvas = source as HTMLCanvasElement
    const probe = document.createElement('canvas')
    probe.width = canvas.width
    probe.height = canvas.height
    const context = probe.getContext('2d')
    if (!context) {
      return { width: canvas.width, height: canvas.height, uniqueBuckets: 0, paintedPixels: 0 }
    }
    context.drawImage(canvas, 0, 0)
    const imageData = context.getImageData(0, 0, probe.width, probe.height).data
    const buckets = new Set<string>()
    let paintedPixels = 0

    for (let index = 0; index < imageData.length; index += 4 * 120) {
      const red = imageData[index]
      const green = imageData[index + 1]
      const blue = imageData[index + 2]
      const alpha = imageData[index + 3]
      if (alpha > 0) {
        paintedPixels += 1
      }
      buckets.add(`${Math.round(red / 16)}-${Math.round(green / 16)}-${Math.round(blue / 16)}-${Math.round(alpha / 16)}`)
    }

    return {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      uniqueBuckets: buckets.size,
      paintedPixels,
    }
  })

  expect(signal.width).toBeGreaterThan(280)
  expect(signal.height).toBeGreaterThan(260)
  expect(signal.uniqueBuckets).toBeGreaterThan(8)
  expect(signal.paintedPixels).toBeGreaterThan(20)
}

test('draws an L shaped room, edits dimensions, syncs 3D, saves, restores, and replays history', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await expect(page.getByRole('heading', { name: '직접 그리는 실측 공간 편집기' })).toBeVisible()

  const lRoomPoints = [
    [200, 150],
    [520, 150],
    [520, 290],
    [380, 290],
    [380, 430],
    [200, 430],
    [200, 150],
  ]

  for (const [x, y] of lRoomPoints) {
    await clickCanvas(page, x, y)
  }

  await expect(page.getByTestId('wall-count')).toContainText('벽 6')
  await expect(page.getByTestId('closed-room-status')).toContainText('닫힌 방: 생성됨')

  await page.getByTestId('tool-select').click()
  await clickCanvas(page, 360, 150)
  await expect(page.getByTestId('selection-label')).toContainText('벽')

  const wallLengthInput = page.getByTestId('wall-length-input')
  await wallLengthInput.fill('420')
  await expect(wallLengthInput).toHaveValue('420')

  await page.getByTestId('door-chip').click()
  await clickCanvas(page, 280, 150)
  await expect(page.getByTestId('opening-count')).toContainText('문/창 1')

  await page.getByTestId('window-chip').click()
  await clickCanvas(page, 200, 300)
  await expect(page.getByTestId('opening-count')).toContainText('문/창 2')

  await expect(page.getByTestId('three-status')).toContainText('3D 방 생성')
  await expect(page.getByTestId('three-status')).toHaveAttribute('data-wall-count', '6')
  await expect(page.getByTestId('three-view').locator('canvas')).toBeVisible()
  await expectThreeCanvasSignal(page)

  const threeView = page.getByTestId('three-view')
  const threeBox = await threeView.boundingBox()
  if (!threeBox) {
    throw new Error('3D view was not visible')
  }
  await page.mouse.move(threeBox.x + threeBox.width * 0.62, threeBox.y + threeBox.height * 0.48)
  await page.mouse.down()
  await page.mouse.move(threeBox.x + threeBox.width * 0.42, threeBox.y + threeBox.height * 0.36, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(350)
  const cameraPoseAfterOrbit = await threeView.getAttribute('data-camera-pose')
  expect(cameraPoseAfterOrbit).toBeTruthy()

  const floorElevationInput = page.getByTestId('floor-elevation-input')
  await floorElevationInput.fill('35')
  await expect(floorElevationInput).toHaveValue('35')
  await expect(page.getByTestId('three-status')).toHaveAttribute('data-floor-elevation', '35')
  await page.waitForTimeout(100)
  await expect(threeView).toHaveAttribute('data-camera-pose', cameraPoseAfterOrbit!)
  await expectThreeCanvasSignal(page)
  await page.screenshot({ path: testInfo.outputPath('desktop-cad-3d.png'), fullPage: false })

  await page.getByTestId('furniture-tool').click()
  await clickCanvas(page, 265, 220)
  await expect(page.getByTestId('asset-count')).toContainText('가구 1')
  await expect(page.getByTestId('three-status')).toHaveAttribute('data-asset-count', '1')

  await page.getByTestId('save-button').click()
  await page.reload()

  await expect(page.getByTestId('wall-count')).toContainText('벽 6')
  await expect(page.getByTestId('opening-count')).toContainText('문/창 2')
  await expect(page.getByTestId('asset-count')).toContainText('가구 1')
  await expect(page.getByTestId('closed-room-status')).toContainText('닫힌 방: 생성됨')
  await expect(page.getByTestId('floor-elevation-input')).toHaveValue('35')

  await page.getByTestId('tool-select').click()
  await clickCanvas(page, 410, 150)
  await expect(page.getByTestId('wall-length-input')).toHaveValue('420')

  await page.getByTestId('wall-length-input').fill('390')
  await expect(page.getByTestId('wall-length-input')).toHaveValue('390')

  await page.getByLabel('실행 취소').click()
  await expect(page.getByTestId('wall-length-input')).toHaveValue('420')

  await page.getByLabel('다시 실행').click()
  await expect(page.getByTestId('wall-length-input')).toHaveValue('390')

  await page.getByTestId('delete-selection').click()
  await expect(page.getByTestId('wall-count')).toContainText('벽 5')
  await expect(page.getByTestId('closed-room-status')).toContainText('닫힌 방: 편집 중')

  await page.getByLabel('실행 취소').click()
  await expect(page.getByTestId('wall-count')).toContainText('벽 6')
  await expect(page.getByTestId('closed-room-status')).toContainText('닫힌 방: 생성됨')
})

test('keeps the generated 3D scene visible on a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: '직사각형 빠른 시작' }).click()
  await expect(page.getByTestId('three-status')).toHaveAttribute('data-wall-count', '4')
  await expect(page.getByTestId('three-view').locator('canvas')).toBeVisible()
  await expectThreeCanvasSignal(page)
  await page.screenshot({ path: testInfo.outputPath('mobile-cad-3d.png'), fullPage: true })
})
