// Playwright CLI callback. Run against the isolated --assistant-preview fixture only.
// eslint-disable-next-line no-unused-expressions -- Playwright CLI evaluates this callback expression.
async (page) => {
  if (!page.url().startsWith('http://127.0.0.1:5173/')) throw new Error('Local preview required')
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const requests = []
  const responses = []
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().endsWith('/api/assistant/message') && request.method() === 'POST') {
      const body = request.postDataJSON()
      requests.push({ message: body.message, history: body.history })
    }
  })
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/assistant/message')) {
      const body = await response.json()
      responses.push({ status: response.status(), mode: body.mode, ids: body.products?.map((p) => p.id) })
    }
  })
  const input = page.getByRole('textbox', { name: 'Повідомлення для AI-помічника' })
  const send = async (message, observeLoading = false) => {
    await input.fill(message)
    const response = page.waitForResponse((r) => r.url().endsWith('/api/assistant/message'))
    await input.press('Enter')
    if (observeLoading) {
      await page.locator('.assistant-loading').waitFor({ state: 'visible' })
      check(await input.isDisabled(), 'Composer should be disabled while awaiting response')
    }
    const result = await response
    await page.waitForTimeout(200)
    return result.status()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForFunction(() => document.querySelector('main h1'), { }, { polling: 100 })
  await page.locator('.assistant-launcher').click()
  check(await send('Привет') === 200, 'Greeting HTTP 200')
  check((await page.locator('.assistant-message-assistant').last().innerText()).includes('помощник Velora'), 'Greeting should introduce the assistant')
  check(await send('Порадь один засіб для сухого волосся.', true) === 200, 'Product HTTP 200')
  check(await page.locator('.assistant-product').count() === 1, 'Exactly one product card')
  await page.screenshot({ path: 'output/assistant-desktop.png' })
  const userCount = await page.locator('.assistant-message-user').count()
  check(await send('тест збою') === 503, 'Failure HTTP 503')
  check(await input.inputValue() === 'тест збою', 'Failed text restored')
  check(await page.getByRole('alert').count() === 1, 'Error is announced')
  await page.screenshot({ path: 'output/assistant-desktop-error.png' })
  const retryResponse = page.waitForResponse((r) => r.url().endsWith('/api/assistant/message'))
  await page.getByRole('button', { name: 'Спробувати ще раз' }).click()
  check((await retryResponse).status() === 200, 'Retry HTTP 200')
  await page.waitForTimeout(200)
  check(await page.locator('.assistant-message-user').count() === userCount + 1, 'Retry must not duplicate user message')
  check(JSON.stringify(requests[2].history) === JSON.stringify(requests[3].history), 'Retry must preserve original history')
  check(await input.inputValue() === '', 'Successful retry clears draft')
  check(await page.getByRole('alert').count() === 0, 'Successful retry clears error')
  check(await send('Його ціна?') === 200, 'Follow-up HTTP 200')
  check(requests.at(-1).history.some((turn) => turn.role === 'assistant' && turn.productIds?.length), 'Product IDs must be included in history')
  const productName = await page.locator('.assistant-product strong').last().innerText()
  await page.locator('.assistant-product').last().click()
  await page.getByRole('button', { name: 'Закрити AI-помічника' }).click()
  check(await page.locator('main h1').innerText() === productName, 'Product card opens actual detail page')

  const pages = []
  for (const route of ['/', '/catalog', '/catalog/dohliad', '/wishlist', '/cart', '/about', '/delivery', '/payment', '/contacts']) {
    await page.goto(`http://127.0.0.1:5173${route}`)
    await page.waitForFunction(() => document.querySelector('main h1'), {}, { polling: 100 })
    check(await page.locator('.assistant-launcher').isVisible(), `Launcher missing on ${route}`)
    pages.push({ route, title: await page.locator('main h1').first().innerText() })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.assistant-launcher').click()
  check(await send('Дякую') === 200, 'Mobile social HTTP 200')
  check(await send('Порадь один засіб для сухого волосся.', true) === 200, 'Mobile product HTTP 200')
  const panel = await page.locator('.assistant-panel').boundingBox()
  check(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= 390 && panel.y + panel.height <= 844, 'Mobile panel is within viewport')
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow')
  await page.screenshot({ path: 'output/assistant-mobile.png' })
  await page.setViewportSize({ width: 390, height: 500 })
  const smallPanel = await page.locator('.assistant-panel').boundingBox()
  check(smallPanel.y >= 0 && smallPanel.y + smallPanel.height <= 500, 'Composer stays reachable in reduced mobile viewport')
  check(errors.length === 0, `Browser JS errors: ${errors.join(',')}`)
  return { pages, responses, localChatRequests: requests.length, desktop: 'passed', mobile: 'passed', retry: 'passed', jsErrors: errors }
}
