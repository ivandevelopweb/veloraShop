import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { authRouter } from './routes/auth.js'
import { cartRouter } from './routes/cart.js'
import { categoriesRouter } from './routes/categories.js'
import { ordersRouter } from './routes/orders.js'
import { paymentsRouter } from './routes/payments.js'
import { productsRouter } from './routes/products.js'
import { adminRouter } from './routes/admin.js'
import { assistantRouter } from './routes/assistant.js'
import { config } from './config.js'
import { errorHandler, notFound } from './errors.js'
import { issueCsrf } from './security.js'

export const app = express()

app.disable('x-powered-by')
if (config.env === 'production') app.set('trust proxy', 1)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com', 'https://res.cloudinary.com'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
)
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      const isAllowed = !origin || config.clientOrigins.includes(origin)
      callback(null, isAllowed)
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  }),
)
app.use(express.json({ limit: '20kb', strict: true }))
app.use(cookieParser())
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store')
  next()
})

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})
app.get('/api/auth/csrf', (_request, response) => {
  response.set('Cache-Control', 'no-store')
  response.json({ csrfToken: issueCsrf(response) })
})
app.use('/api/auth', authRouter)
app.use('/api/cart', cartRouter)
app.use('/api/orders', ordersRouter)
app.use(
  '/api/payments/liqpay/callback',
  express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 2 }),
)
app.use('/api/payments', paymentsRouter)
app.use('/api/products', productsRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/assistant', assistantRouter)
app.use('/api/admin', adminRouter)
app.use(notFound)
app.use(errorHandler)
