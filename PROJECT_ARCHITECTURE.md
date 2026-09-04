# Velora — архитектура проекта

Документ описывает устройство проекта, границы модулей и путь данных. Фронтенд и API разделены: каталог, пользователи, корзины и заказы хранятся на сервере и в PostgreSQL, а не в React-коде.

## Стек и окружения

- Frontend: TypeScript, React 19, Vite, CSS.
- Backend: Node.js, Express 5, TypeScript.
- Database: PostgreSQL (локально Docker, production Neon).
- Auth: opaque server sessions в PostgreSQL, `HttpOnly` cookie.
- Deploy: Netlify отдаёт статический Vite build; Render запускает Express API; Neon предоставляет PostgreSQL.
- Optional media: Cloudinary для новых загрузок изображений из админки.

Production URLs текущего деплоя:

```text
Frontend: https://velora-shopping.netlify.app
API:      https://velora-api-cg44.onrender.com
Health:   https://velora-api-cg44.onrender.com/api/health
```

Если URL изменятся, актуальные значения находятся в Netlify `VITE_API_ORIGIN` и Render `CLIENT_ORIGINS`.

## Дерево frontend

```text
src/
├─ main.tsx                       # точка входа React
├─ App.tsx                        # публичный re-export storefront-приложения
├─ App.css, index.css             # стили витрины и базовые токены
├─ fullbleed.css                  # layout-правила полноширинных секций
├─ admin.css                      # стили админки
├─ assets/                        # hero, logo и локальные графические ресурсы
├─ shared/
│  ├─ api/
│  │  ├─ client.ts                # единый fetch-клиент, CSRF, credentials, API origin
│  │  └─ types.ts                 # DTO и модели ответов API
│  ├─ lib/
│  │  ├─ format.ts                # форматирование цены/отображения
│  │  └─ storage.ts               # допустимые локальные UI-настройки
│  └─ ui/
│     ├─ Brand.tsx                # брендовый логотип/название
│     └─ Icon.tsx                 # общий набор иконок
├─ storefront/
│  ├─ StorefrontApp.tsx           # состояние витрины и публичная маршрутизация
│  ├─ components/                 # Header, Footer, Summary, rails и общие блоки
│  ├─ hooks/                      # загрузка каталога и toast-состояние
│  ├─ model/                      # cart/display product модели и чистые преобразования
│  └─ pages/                      # Home, Catalog, Product, Cart, Checkout, Account, About
└─ admin/
   ├─ AdminApp.tsx                # layout и маршрутизация /admin
   ├─ components/                 # sidebar, таблицы и общие admin-блоки
   ├─ model/adminModel.ts         # RouteState и преобразование URL
   └─ pages/                      # Dashboard, Products, Editor, Orders, Detail, Categories
```

### Граница витрины

`StorefrontApp` владеет только UI-состоянием: текущей страницей, выбранным товаром, фильтрами, toast, user session, cart и orders. Товары загружаются через `api.getProducts()` и `useCatalog`; product fallback-массивов в frontend быть не должно.

Страницы принимают данные и callback-и через props. Запросы к серверу не дублируются по страницам — для них используется `src/shared/api/client.ts`.

### Граница админки

`AdminApp` монтируется из публичного приложения только для пользователя с `role === 'admin'`. Админские страницы вызывают `api.admin.*`, а маршруты `/admin/...` восстанавливаются через `adminModel.ts` и `history.pushState`. Дизайн админки отделён в `admin.css`.

## Backend

```text
server/
├─ src/
│  ├─ index.ts                    # запуск HTTP-сервера, bind 127.0.0.1/0.0.0.0
│  ├─ app.ts                      # Express middleware, CORS, Helmet и route mounting
│  ├─ config.ts                   # Zod-проверка env и production-ограничения
│  ├─ db.ts                       # pg Pool, транзакции и генерация UUID
│  ├─ auth.ts                     # чтение/проверка server session и ролей
│  ├─ auth-rate-limit.ts          # лимит попыток аутентификации
│  ├─ security.ts                 # CSRF и cookie-параметры
│  ├─ errors.ts                   # ApiError, 404 и единый error handler
│  ├─ http.ts                     # asyncHandler и HTTP-вспомогательные функции
│  ├─ catalog.ts                  # каталоговые преобразования/запросы
│  ├─ media.ts                    # Cloudinary и проверка изображений
│  ├─ seed.ts                     # идемпотентное заполнение тестового каталога/admin
│  └─ routes/
│     ├─ auth.ts                  # register, login, logout, me, csrf
│     ├─ products.ts              # публичный каталог и фильтры
│     ├─ categories.ts            # публичные категории
│     ├─ cart.ts                  # корзина текущего пользователя
│     ├─ orders.ts                # оформление заказа и история заказов
│     └─ admin.ts                 # dashboard, catalog CRUD, media, orders
└─ migrations/
   ├─ 001_initial_schema.mts      # users, sessions, products, cart, orders
   ├─ 002_catalog_admin.mts       # categories, media, admin, расширение products/orders
   └─ 003_inventory_quantity_limit.mts
```

### API-маршруты

Все маршруты имеют префикс `/api` и ответы JSON.

```text
GET    /api/health
GET    /api/auth/csrf
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/products
GET    /api/categories
GET    /api/cart
POST   /api/cart
PATCH  /api/cart/:productId
DELETE /api/cart/:productId
GET    /api/orders
POST   /api/orders
GET/PATCH/POST/DELETE /api/admin/...
```

Mutation-запросы с cookie-сессией требуют `X-CSRF-Token`. Все пользовательские ресурсы проверяют ownership; admin API дополнительно проверяет роль.

## База данных

Главные сущности:

- `users` — email, password hash, role.
- `sessions` — hash opaque session token, срок действия, user FK.
- `products` — цена в UAH, остаток `stock`, availability/status, описание и даты.
- `categories`, `product_images` — категории и изображения.
- `cart_items` — пользователь + товар + quantity с ограничением по остатку/лимиту.
- `orders`, `order_items` — snapshot заказа, доставка и fulfilment status.
- `order_status_events` — история изменений заказа.
- `admin_audit_log` — аудит действий администратора.

Миграции применяются только вперёд. Уже применённую миграцию нельзя редактировать; для изменения схемы создаётся следующий файл в `server/migrations`.

## Аутентификация и безопасность

- Пароли хешируются на сервере через bcrypt.
- Session token не хранится во frontend/localStorage; в браузере только `HttpOnly`, `Secure` в production cookie.
- Production frontend/API находятся на разных доменах: `SameSite=None`, `Secure=true`, точный `CLIENT_ORIGINS` без wildcard.
- `helmet`, CORS allowlist, CSRF и auth rate limit включены.
- Весь SQL — параметризованный.
- Env-файлы и секреты не коммитить. `VITE_*` не являются секретными: они попадают в клиентский bundle.

## Конфигурация

Основные переменные Render/API:

```text
NODE_ENV=production
DATABASE_URL=<Neon TLS connection string>
CLIENT_ORIGINS=https://velora-shopping.netlify.app
CSRF_SECRET=<generated secret>
SESSION_COOKIE_SECURE=true
COOKIE_SAME_SITE=none
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD=<admin password>
```

Опционально добавляются три Cloudinary-переменные для загрузки изображений. Секреты хранятся только в Render.

Frontend build-time variable:

```text
VITE_API_ORIGIN=https://velora-api-cg44.onrender.com
```

После изменения `VITE_API_ORIGIN` нужен новый Netlify deploy.

## Локальная разработка и проверки

```powershell
npm ci
npm run dev:all          # Vite :5173 + API :4000
npm run build            # production frontend
npm run build:server     # TypeScript backend
npm run lint
npm run migrate:up
npm run seed
```

Render запускает `npm run migrate:up && node server/dist/seed.js && npm run start:server`. Бесплатный Render может просыпаться с задержкой; это не причина добавлять frontend fallback-данные.

## Правила дальнейших изменений

1. Не возвращать каталог или mock-продукты в React-код.
2. Новые доменные запросы добавлять в backend route/service и типизированный API client.
3. Секреты никогда не передавать через Netlify и `VITE_*`.
4. Перед push запускать build, server build и lint.
5. Для новых подсистем сначала описать поток и границы ответственности, затем менять код.
