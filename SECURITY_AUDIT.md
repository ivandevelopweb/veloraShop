# SECURITY AUDIT — Velora

Дата исходного аудита: 2026-09-04  
Дата remediation-проверки: 2026-09-04  
Режим: исходный независимый аудит и последующая локальная remediation-проверка. Реальные LiqPay платежи не включались.

## Executive Summary

**Вердикт: READY AFTER FIXES — только SANDBOX-ONLY.**

В текущем коде не подтверждены клиентская подмена цены, userId, роли, paymentStatus или прямой BOLA/IDOR между двумя обычными пользователями. Сервер заново получает цену и владельца из БД, а административные маршруты проверяют роль из серверной сессии.

Подтверждённые code-level blockers H-01, H-02, M-01 и M-02 исправлены и проверены HTTP integration/concurrency suite на чистой PostgreSQL в Docker. Две независимые checkout-попытки на последний товар теперь создают ровно один durable reservation; valid callback не зависит от текущей доступности каталога.

Перед deployment остаются только внешние preflight-проверки: применить migration 005 к целевой БД с backup, задать точные Render/Netlify environment values и провести санкционированный LiqPay sandbox callback/reconciliation smoke test. Они не являются непочиненным application-code blocker и не разрешают real-money rollout.

Исторические описания уязвимого состояния ниже сохранены как evidence исходного аудита; remediation status и финальный вердикт в конце документа имеют приоритет.

Исторический файл security_best_practices_report.md использовался только как контекст. Его выводы перепроверены по текущему коду; в частности, фактический проект уже содержит LiqPay-маршруты, хотя часть архитектурной документации описывает более раннее состояние.

## Architecture assessment

| Граница | Текущее состояние | Оценка |
|---|---|---|
| Frontend | React/Vite, Netlify, API origin задаётся публичной build-переменной VITE_API_ORIGIN | Frontend не является security boundary; сервер не полагается на его цены, роли или UI-gating. |
| API | Express 5, PostgreSQL, Helmet, строгий JSON 20 KB, parameterized SQL | Базовая серверная архитектура разумная. |
| Authentication | Непрозрачный случайный токен в HttpOnly cookie, в БД хранится SHA-256 hash токена | Нет session fixation через присланный клиентом token; есть expiry и server-side logout. |
| Cross-site frontend/API | Netlify frontend и Render API, exact CORS allowlist, credentials, SameSite=None, signed double-submit CSRF | Конструкция корректна для разных HTTPS origins при фактической правильной Render-конфигурации. |
| Payment | LiqPay sandbox-only; browser result_url лишь UI, authoritative callback/status API проходят server validation | Checkout сначала атомарно создаёт order snapshot + reservation; form возвращается только после commit. |
| Database | PostgreSQL transactions, row locks, partial unique indexes и DB reservation constraints | `stock` — physical stock; `reserved_stock` — active holds; terminal reservation transition защищён conditional UPDATE и trigger. |

## Threat model

Принято, что browser/frontend полностью недоверен. Проверялись прямые API-запросы с изменёнными route/query parameters, JSON body, CSRF header, cookie, ID, quantity, price, userId, role, order и payment fields.

Контролем доступа считается только серверная сессия и серверные SQL-проверки. Знание product ID или order code User A не должно давать User B доступ к данным или операциям User A. Browser result_url не считается подтверждением оплаты.

## Production blockers

| ID | Severity | Статус | Итог |
|---|---|---|---|
| H-01 | High | **FIXED** | Durable reservation исключает two-checkout oversell и paid-without-stock race. |
| H-02 | High | **FIXED** | Soft archive и immutable order snapshot не разрывают pending/paid order. |
| M-01 | Medium | **FIXED** | Login quota reservируется атомарным conditional UPSERT до bcrypt. |
| M-02 | Medium | **FIXED** | Lockfile обновлён до qs 6.16.0; production audit clean. |

Непочиненных application-code production blockers не осталось. LiqPay остаётся sandbox-only.

## Critical

Подтверждённых Critical-уязвимостей нет.

Не найден путь, по которому обычный пользователь может отправить paid=true, выбрать другого userId, передать собственную цену/total или назначить себе admin через зарегистрированный JSON body.

## High

### H-01 — durable inventory reservation между checkout и callback — **FIXED**

- **Severity:** High → fixed.
- **Endpoints:** POST /api/payments/liqpay/checkout; POST /api/payments/liqpay/callback; expiry reconciliation worker; cancel.
- **Files:** server/migrations/005_inventory_reservations.mts; server/src/routes/payments.ts; server/src/payments.ts; server/src/payment-reconciliation.ts; server/src/index.ts.
- **Architecture:** `products.stock` хранит physical stock, `products.reserved_stock` — сумму active holds, availability = `stock - reserved_stock`. Checkout в одной PostgreSQL transaction берёт locks в порядке `user → new order shell → cart rows → products by ascending ID → reservations`, проверяет availability, создаёт immutable order/items/reservations и increment `reserved_stock`. LiqPay data/signature создаются только после commit.
- **State machine:** reservation `active → consumed` (paid) либо `active → released` (cancel/final provider failure); оба UPDATE используют `WHERE state = 'active'`. Trigger не разрешает менять `consumed`/`released`. Payment: `pending → paid|failed|cancelled|reconciliation_required`; active reconciliation может завершиться authoritative result, но late paid после released/terminal state остаётся `reconciliation_required` с provider event/reason.
- **Evidence / reproduced:** yes. PostgreSQL integration test одновременно запускает два checkout при stock=1 и получает ровно `[201,409]`, один reservation и единственный decrement после callback. Отдельно проверены replay, two callbacks, callback-vs-expiry, cancel-vs-callback, repeated release/consume, terminal expiry и late paid after release.
- **Recommended operational control:** worker делает status lookup до release; network/non-final response держит reservation до grace, затем создаёт `reconciliation_required`. Active reconciliation rows повторно проверяются worker; released late payment требует ручной refund/reconciliation, а не silent paid transition.

### H-02 — catalog lifecycle мог нарушить pending order — **FIXED**

- **Severity:** High → fixed.
- **Endpoints:** PATCH/DELETE /api/admin/products/:id; callback/worker paid transition.
- **Files:** server/migrations/005_inventory_reservations.mts; server/src/routes/admin.ts; server/src/payments.ts; server/src/routes/products.ts; server/src/routes/cart.ts; server/src/routes/categories.ts.
- **Architecture/policy:** order item stores immutable `product_name`, `product_slug`, `price_uah`, `quantity`; reservation has a composite FK to that exact item and product FK with `ON DELETE RESTRICT`. Normal admin DELETE is now a soft archive (`status='archived'`, `is_available=false`), so it blocks new cart/checkout but preserves an active hold’s right to finish. Normal stock PATCH locks the product and rejects `new_stock < reserved_stock`; price mutation does not affect snapshot. The paid path works from complete reservation rows and does not INNER JOIN catalog to decide purchased positions.
- **Evidence / reproduced:** yes. Tests cover checkout-vs-archive, checkout-vs-admin-stock, archive before valid callback, and price mutation before callback. The archived order becomes paid with the original price and slug snapshot; no row is silently lost.
- **Maintenance policy:** physical catalog deletion is intentionally not exposed through ordinary admin routes. A separately authorised maintenance workflow may purge terminal reservation/history records only after retention requirements and absence of active holds are verified.

## Medium

### M-01 — parallel login limiter — **FIXED**

- **Severity:** Medium → fixed.
- **Endpoint/files:** POST /api/auth/login; server/src/auth-rate-limit.ts; server/src/routes/auth.ts.
- **Root cause removed:** `reserveLoginAttempt` consumes both sorted IP and account quota keys in one transaction through a conditional UPSERT. The statement increments only while `attempt_count < maximum`; it is the atomic check and increment before bcrypt.
- **Evidence / reproduced:** yes. 20 concurrent invalid HTTP logins against PostgreSQL return exactly ten 401 and ten 429, rather than allowing all 20 bcrypt attempts.
- **Recommended hardening:** preserve edge/WAF limiting as defence in depth; it is not required to close the DB race.

### M-02 — vulnerable qs lockfile entry — **FIXED**

- **Severity:** Medium → fixed.
- **Files:** package-lock.json.
- **Change:** non-forced `npm audit fix --package-lock-only` updated transitive qs from 6.15.3 to 6.16.0 without a major application dependency upgrade.
- **Evidence / reproduced:** `npm audit --omit=dev` reports `found 0 vulnerabilities`; `npm ls qs` resolves Express/body-parser to qs 6.16.0.

## Low / hardening

Пункты ниже являются hardening/release observations, а не подтверждёнными эксплуатационными уязвимостями. Поэтому для них нет отдельного attack reproduction.

### L-01 — session lifecycle можно усилить

- **Severity:** Low / hardening.
- **Endpoint:** POST /api/auth/login, POST /api/auth/logout.
- **Location:** server/src/auth.ts:16-43, 68-73; server/src/security.ts:50-59.
- **Assessment:** session fixation не подтверждён: login/register всегда создаёт новый случайный token, а не принимает клиентский. В БД хранится только SHA-256 hash; session cookie HttpOnly и expire через 7 дней. Logout удаляет именно текущую session.
- **Residual risk:** украденный bearer cookie остаётся применимым до expiry либо logout именно той сессии; глобального session revocation/device management нет.
- **Reproduced:** n/a — это design hardening, не подтверждённый bypass session controls.
- **Recommended fix:** при будущей смене пароля/compromise flow удалять все sessions пользователя; рассмотреть idle timeout и список устройств. Это не blocker.

### L-02 — задать верхнюю границу quantity на API-уровне

- **Severity:** Low / hardening.
- **Endpoint:** PATCH /api/cart/:productId.
- **Location:** server/src/routes/cart.ts:16-18, 93-105.
- **Assessment:** 0 и отрицательные quantity отвергаются. Большое корректное integer значение не меняет цену или ownership и в итоге clamped к server-side stock, но нет явного max в Zod. Чрезмерный integer может давать неясную DB/API ошибку вместо controlled 4xx.
- **Reproduced:** no — не запускался against local database; risk относится к error handling, не к обходу inventory.
- **Recommended fix:** добавить разумный .max, согласованный с моделью inventory, и тест на huge quantity. Это не позволяет переписать stock или total.

### L-03 — усилить payment event auditability

- **Severity:** Low / hardening.
- **Endpoint:** POST /api/payments/liqpay/callback.
- **Location:** server/src/routes/payments.ts:48-59, 282-299, 334-340.
- **Assessment:** forged callback не проходит signature/private-key, public_key, amount, currency и order binding; paid state terminal в текущем коде. payment_id допускается optional, поэтому часть валидного provider event может не иметь durable event identifier для последующей операционной сверки.
- **Reproduced:** n/a — hardening для observability/reconciliation, не bypass подписи.
- **Recommended fix:** по правилам sandbox provider требовать/сохранять provider payment/event ID для final paid state, хранить immutable callback-event audit record и явно документировать допустимые provider state transitions. Не считать browser result_url подтверждением оплаты.

### L-04 — документация и runtime deployment требуют синхронизации

- **Severity:** Low / release hardening.
- **Evidence:** PROJECT_ARCHITECTURE.md частично описывает прошлое состояние без фактического LiqPay flow; render.yaml не содержит LiqPay secrets и CLIENT_ORIGINS как значения, они должны быть заданы вне repo; Netlify VITE_API_ORIGIN также build-time setting.
- **Reproduced:** n/a — dashboard configuration не доступна репозиторию.
- **Recommended fix:** обновить architecture/deployment runbook после исправления High issues, добавить preflight checklist и release smoke test. Не хранить значения secrets в документации или report.

## Authorization matrix

Условные обозначения: ✓ — разрешено; Own — только объект владельца server session; 401/403 — отказ; 404 — намеренно не раскрывает существование чужого объекта.

| Non-public route / method | Guest | User A | User B, знающий ID/code User A | Admin |
|---|---:|---:|---:|---:|
| GET /api/auth/me | 401 | Own profile | Own profile, не A | Own profile |
| POST /api/auth/logout | 401/без эффекта без token | current session | current session | current session |
| GET /api/cart | 401 | Own cart | Own cart, не A | Own cart |
| POST /api/cart | 401 | Own cart only | Own cart only | Own cart only |
| PATCH /api/cart/:productId | 401 | Own cart row | не может менять cart row A | Own cart row |
| DELETE /api/cart/:productId | 401 | Own cart row | не может удалить cart row A | Own cart row |
| GET /api/orders | 401 | Own orders | Own orders, не A | Own orders |
| POST /api/payments/liqpay/checkout | 401 | Own cart/order | Own cart/order, не A | Own cart/order |
| GET /api/payments/liqpay/orders/:code | 401 | Own code | 404 for code A | Own code; admin listing is a separate route |
| POST /api/payments/liqpay/orders/:code/cancel | 401 | Own pending payment | 404 for code A | Own pending payment; admin status route is separate |
| POST /api/payments/liqpay/callback | 400 без валидной provider подписи | не role-based | не role-based | не role-based; только подписанный LiqPay callback |
| GET /api/admin/dashboard | 401 | 403 | 403 | ✓ |
| GET/POST/PATCH/DELETE /api/admin/products и product images | 401 | 403 | 403 | ✓; mutation также CSRF |
| GET/POST/PATCH/DELETE /api/admin/categories | 401 | 403 | 403 | ✓; mutation также CSRF |
| GET /api/admin/orders, GET /api/admin/orders/:code, PATCH /api/admin/orders/:code/status | 401 | 403 | 403 | ✓; PATCH также CSRF |

Подтверждение ownership: cart SQL всегда включает cart_items.user_id = authenticated userId (server/src/routes/cart.ts:45, 54, 97-103, 120-123); orders list включает user_id = auth.userId (server/src/routes/orders.ts:20-25); payment read/cancel включает code и auth.userId (server/src/routes/payments.ts:184-187, 208-212). User-controlled userId в эти SQL не передаётся.

Проверка privilege escalation:

- registration schema не содержит role/isAdmin, а INSERT записывает только id, name, email, password_hash (server/src/routes/auth.ts:36-66);
- sensitive admin payloads strict и fields перечислены явно (server/src/routes/admin.ts:24-44);
- каждый admin route проходит adminOnly, который получает role из sessions JOIN users, а не из JSON/cookie field (server/src/auth.ts:30-54; server/src/routes/admin.ts:73-75);
- UI role-gating не считается контролем: прямой запрос customer к /api/admin/* всё равно получает 403.

## Orders and pricing review

| Поле/атака | Фактический trusted source | Результат |
|---|---|---|
| price, subtotal, total | products.price_uah и cart_items.quantity под DB-lock во время checkout | Клиент их не отправляет и не может подменить. |
| delivery cost | server logic: 0 от 1500 UAH, иначе 90 | Не принимается в checkout JSON. |
| owner/userId | authenticated opaque session | userId не входит в checkout schema. |
| paymentStatus/orderStatus | подписанный callback либо admin state route | paid=true в body checkout не принимается. |
| quantity=0 или -1 | Zod min(1), DB CHECK | Отклоняется. |
| huge quantity | LEAST(input, products.stock) | Не даёт купить сверх stock; см. L-02 для controlled max. |
| неизвестный/нет в stock товар | server SELECT active/available/stock и error | Отклоняется. |
| цена изменилась после добавления в cart | checkout читает текущую DB price, затем snapshot в order_items | Берётся новая trusted price, не старая browser price. |
| повторный checkout одного user | lockUserPaymentState + partial unique one pending payment per user | Возвращает тот же pending order, duplicate order не создаётся. |

Позитивный вывод: server-side pricing и ownership реализованы корректно. После remediation price/slug/name/quantity immutable snapshot создаётся вместе с reservation, а callback расходует только complete active reservations; последующая catalog price change не меняет заказ.

## Payment review

Проверено:

- checkout schema strict и не содержит price, total, product list, userId, owner, paymentStatus или orderStatus (server/src/routes/payments.ts:23-33);
- callback требует x-www-form-urlencoded envelope, base64 bounds, timing-safe signature с private key, затем сверяет public_key, action, version, UAH, amount и payment_order_id (строки 37-59, 236-283);
- result_url содержит только order code для UI-polling; он не меняет payment state;
- order payment binding защищён unique payment_order_id, unique non-null provider_payment_id и order amount check (migration 004_liqpay_payments.mts:25-30; payments.ts:282-286);
- повторный callback после paid идемпотентно завершается до повторного stock decrement (payments.ts:278-288);
- два callback одновременно сериализуются user/order/product locks; guarded stock UPDATE предотвращает double decrement;
- paid нельзя затем перевести в failed/cancelled обычным callback path, потому что paid return выполняется раньше state update;
- cancel запроса покупателя не может отменить paid; admin cancellation опирается на locked order transition и restock выполняется один раз при достижении cancelled.

Sandbox-only: config в production требует LiqPay keys, принудительно требует LIQPAY_SANDBOX=true и sandbox_-public key (server/src/config.ts:65-79, 115-117). Реальные payment keys не должны быть добавлены. Фактические secret values и provider dashboard state не были доступны аудиту.

H-01/H-02 закрыты. Дополнительно callback/payment ID сериализуется PostgreSQL advisory lock и unique provider-payment index: попытка применить один provider payment ID ко второму order переводит второй order в reconciliation, не списывая stock. Browser result_url по-прежнему не является доказательством оплаты.

## Concurrency review

| Scenario | Result |
|---|---|
| Два checkout одного user | Защищено: user row lock + unique partial index pending payment. |
| Callback replay одного paid order | Защищено: FOR UPDATE и early return для paid. |
| Два callback на один provider payment | Защищено от double stock decrement; provider ID conflict/unique index дополнительно ограничивают связывание. |
| Два покупателя, последний товар | Защищено: первый checkout increments `reserved_stock`; второй получает 409 до выдачи payment form. |
| Admin archive/stock mutation после checkout | Archive разрешён и блокирует лишь new checkout; stock patch rejects `new_stock < reserved_stock`; snapshot order не зависит от current catalog. |
| Paid order cancellation/restock | Admin cancellation locks order then products ascending; payment reservation уже consumed, restock выполняется ровно один раз в transition. |
| Частичная DB ошибка во время paid callback | withTransaction откатывает decrement и payment state вместе, что хорошо; но после external provider payment нужен reconciliation path. |

### Global lock order and state transitions

All inventory paths follow one lock discipline, documented in server/src/payments.ts: `user → order (or new transaction-local order shell) → that user’s cart rows → products ordered by ascending ID → reservation rows`. Callback and worker first resolve the owner then enter this order; admin fulfilment cancellation does `order → products ascending`; archive/stock mutation takes only its product lock. Provider payment IDs additionally use transaction advisory locking so a duplicated provider ID cannot race across two orders.

`inventory_reservations`: `active → consumed` on paid, `active → released` on cancel/final failed; terminal states are immutable. `orders.payment_status`: `pending → paid|failed|cancelled|reconciliation_required`; an active reconciliation can later become terminal from a provider status lookup. A paid event after a released/terminal reservation — or a signed conflicting provider payment ID — becomes `reconciliation_required`, with sanitised provider event/reason retained for refund/manual handling; ordinary paid replay and paid→failed/cancelled are terminal/no-op.

## ZAP triage

В репозитории не найдено zap-report.json или zap-report.xml. Проверен локальный HTML отчёт 2026-09-04-ZAP-Report-/2026-09-04-ZAP-Report-.html. Учитывались только alerts для velora-api-cg44.onrender.com и velora-shopping.netlify.app; Google Pay, LiqPay, PrivatBank, Google Analytics, Unsplash, CDN и другие third parties исключены.

| Target | ZAP alert | Verdict | Обоснование / exploit scenario |
|---|---|---|---|
| API | Cookie No HttpOnly Flag на GET /api/auth/csrf | False positive | Это намеренно readable CSRF cookie, а не session. Session cookie HttpOnly (security.ts:50-55). Знание CSRF token без session не даёт auth. |
| API | Cookie SameSite=None | False positive | Необходимо для Netlify → Render cookie flow. Cookie Secure, host-only __Host name, exact CORS и signed double-submit CSRF снижают cross-site write риск. |
| API | Timestamp Disclosure Unix на product list | Informational / false positive | Scanner сопоставил timestamp-подобную часть публичного Unsplash image identifier; это не server timestamp/secret. |
| API | Authentication Request Identified | Informational | Распознана нормальная login form request, не exploit. |
| API | Session Management Response Identified | Informational | Распознан CSRF endpoint; session design оценивается отдельно и не хранит token в browser storage. |
| API | User Agent Fuzzer | Informational | User-Agent не участвует в authorization; logout требует current session и CSRF. |
| Storefront | Browser Local Storage | False positive | Local storage содержит только публичный wishlist velora-wishlist, не session/token/PII. |
| Storefront | Modern Web Application | Informational | Технологическая классификация. |
| Storefront | Retrieved from Cache / Re-examine Cache-Control | Informational | Относится к static frontend assets. API ответам выставляется Cache-Control: no-store (app.ts:51-54). |

Ни один относящийся к Velora ZAP alert не является подтверждённым production blocker. Не рекомендуется добавлять формальные headers только ради scanner score.

## Dependency/deployment review

Положительное:

- .env не tracked; .env.example содержит только placeholders. При ограниченном поиске tracked source/history не найдено реальных DB URL, LiqPay private key, Cloudinary secret, password или session token. Значения .env в этот отчёт не выводились.
- В production config обязательны CSRF_SECRET, explicit CLIENT_ORIGINS, Secure cookie, SameSite=None, exact HTTPS origins и LiqPay keys; unsafe production combinations fail fast (server/src/config.ts:95-118).
- Cookie names __Host-velora-session и __Host-velora-csrf используются с Path=/, Secure в production и без Domain attribute, что соответствует __Host requirements.
- API отключает x-powered-by, использует Helmet, exact CORS allowlist/credentials, strict JSON limit и no-store для /api.
- Netlify CSP ограничивает scripts default-src self, framing, forms и media origins; заголовки не подменяют server authorization.
- Render build использует npm ci --include=dev, затем TypeScript server build. start:render запускает migrations и idempotent seed.

Требует release-проверки:

1. В Render dashboard должны существовать точные CLIENT_ORIGINS (без localhost/dev origin), DATABASE_URL, CSRF_SECRET и только sandbox LiqPay keys. render.yaml оставляет часть этих значений как sync:false, поэтому repo не доказывает реальную настройку.
2. В Netlify должен быть точный VITE_API_ORIGIN на Render API. Это публичная переменная, но неверное значение ломает auth/payment UX.
3. Проверить на настоящем Render path, что proxy topology соответствует app.set('trust proxy', 1), Set-Cookie действительно имеет Secure; HttpOnly для session; SameSite=None; Path=/; no Domain; а CORS не возвращает credential headers для чужого Origin.
4. Проверить migration state, backup/restore и права production DB. start:render запускает migrations/seed на каждом старте; это требует управляемой operational policy.
5. Проверить sanctioned LiqPay sandbox callback end-to-end и ручной процесс reconciliation/refund до любого real-money rollout.

## Required automated tests

Implemented: `npm test` starts an isolated `postgres:16-alpine` Docker container with random test credentials, applies migrations and runs real HTTP/transaction tests. It never uses production data or LiqPay network access.

Passed coverage includes:

1. guest 401 and authenticated missing/invalid CSRF 403;
2. User A/User B order and cart IDOR denial; customer 403/admin 200; strict role/isAdmin mass assignment rejection;
3. price/subtotal/total/delivery/userId/paymentStatus/orderStatus injection rejection, plus server-side price/snapshot assertion;
4. zero/negative/huge quantity, nonexistent and out-of-stock products;
5. forged signature and wrong amount/order_id/public_key/currency callbacks;
6. payment ID reuse on another order goes to reconciliation, not paid;
7. callback replay and two concurrent callbacks, with exact-once consume;
8. two-user last-unit race, checkout-vs-stock-update, checkout-vs-archive, archive before callback and price mutation snapshot;
9. callback-vs-expiry worker, provider outage/grace/reconciliation recovery, final failed expiry release, cancel-vs-callback, repeated release and late paid after release;
10. DB `reserved_stock <= stock`, terminal reservation transition guard, and legacy pending sandbox migration;
11. 20 concurrent invalid logins yielding exactly 10 × 401 and 10 × 429.

Remaining test work is deployment-owned: an authorised Netlify↔Render browser smoke test (real CORS/cookies/CSRF), provider sandbox dashboard callback/reconciliation test, and CI execution of `npm test` on every change.

## Commands executed and results

| Command/check | Result |
|---|---|
| npm run build | Passed (Vite production build). |
| npm run build:server | Passed (TypeScript server build). |
| npm run lint | Passed (oxlint). |
| npm test | Passed: 13 HTTP integration/concurrency tests plus a separate legacy-migration test on isolated Docker PostgreSQL; 0 failures. |
| node-pg-migrate on fresh PostgreSQL | Passed: migrations 001–005; separate test applied 001–004, seeded legacy pending/paid rows, then applied 005 and repeated it safely. |
| npm audit fix --package-lock-only | Passed without `--force`; qs updated 6.15.3 → 6.16.0. |
| npm audit --omit=dev | Passed: `found 0 vulnerabilities`. |
| npm ls qs | Passed: Express/body-parser dedupe to qs 6.16.0. |
| Source review of frontend, server/src, migrations, package/package-lock, docs, netlify.toml, render.yaml | Completed. |
| git tracked-file/secret-oriented review | .env is ignored; only placeholder .env.example tracked; no secret values copied into audit. |
| Search for ZAP JSON/XML | Not found; HTML report triaged. |
| Local PostgreSQL/Docker availability | Available. Tests use only ephemeral `postgres:16-alpine` containers and remove them after the run. |
| Live production health/header smoke request | Not performed during remediation; no destructive or third-party attack was performed. |

## Uncertainties / things requiring manual verification

- The deployed Render revision may differ from this checkout; source review cannot prove deployment parity.
- Render/Netlify dashboard environment variables, actual CORS allowlist, real Set-Cookie headers, proxy chain and database secret rotation were not accessible.
- High scenarios and concurrent login limiting were exercised locally through HTTP against PostgreSQL, but that does not prove the deployed Render revision or provider dashboard configuration.
- LiqPay dashboard callback delivery/retry semantics and the operational refund/manual reconciliation runbook require an authorised sandbox test, not probing a third-party production service.
- Database backup, restore, migration history and least-privilege roles require infrastructure access.
- The local ignored .env contains a development-only configuration that was not disclosed or modified; it is not evidence of production configuration.

## Final deployment verdict

**READY AFTER FIXES для sandbox-only deployment.**

H-01/H-02/M-01/M-02 закрыты кодом, DB constraints и повторяемыми PostgreSQL integration tests. Перед выпуском выполнить deployment preflight из раздела неопределённостей; в частности, применить migration с backup, подтвердить production CORS/cookies и проверить LiqPay sandbox callback/reconciliation workflow.

LiqPay должен оставаться только в sandbox режиме. Этот аудит не разрешает включение реальных платежей.

## REMAINING PRODUCTION BLOCKERS

**Нет подтверждённых application-code production blockers.**

Внешние release gates: точные Render/Netlify env values, production DB backup/migration policy и authorised LiqPay sandbox end-to-end check. До их ручного подтверждения real-money LiqPay rollout запрещён.
