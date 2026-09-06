import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { Icon } from '../../shared/ui/Icon'

const paymentLabels = {
  pending: {
    eyebrow: 'LiqPay підтверджує платіж',
    title: 'Перевіряємо оплату',
    text: 'Щойно отримаємо захищене підтвердження від LiqPay, оновимо статус замовлення.',
  },
  paid: {
    eyebrow: 'Оплату підтверджено',
    title: 'Дякуємо за замовлення',
    text: 'Ми отримали підтвердження від LiqPay і вже готуємо ваше замовлення.',
  },
  failed: {
    eyebrow: 'Оплата не пройшла',
    title: 'Спробуйте ще раз',
    text: 'LiqPay не підтвердив платіж. Товари залишилися у вашому кошику.',
  },
  cancelled: {
    eyebrow: 'Оплату скасовано',
    title: 'Замовлення не оплачено',
    text: 'Ви можете повернутися до кошика й повторити оплату, коли буде зручно.',
  },
  expired: {
    eyebrow: 'Строк оплати минув',
    title: 'Платіж не завершено',
    text: 'Спробуйте оформити нове замовлення, коли будете готові до оплати.',
  },
  reconciliation_required: {
    eyebrow: 'Потрібна перевірка платежу',
    title: 'Ми звіряємо статус оплати',
    text: 'Якщо платіж пройшов, команда підтримки завершить звірку або оформить повернення.',
  },
}

function orderCodeFromSearchParams(searchParams: URLSearchParams) {
  const code = searchParams.get('order')?.trim() ?? ''
  return /^VL-\d{4}-[A-F0-9]{12}$/.test(code) ? code : ''
}

export function PaymentResult({ loading, onSettled }) {
  const [searchParams] = useSearchParams()
  const code = orderCodeFromSearchParams(searchParams)
  const [status, setStatus] = useState('pending')
  const [error, setError] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)
  const onSettledRef = useRef(onSettled)

  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  useEffect(() => {
    if (loading || !code) return
    let active = true
    let attempts = 0
    let timer
    const poll = async () => {
      try {
        const response = await api.getLiqpayPayment(code)
        if (!active) return
        setStatus(response.order.paymentStatus)
        if (response.order.paymentStatus !== 'pending') {
          void onSettledRef.current()
        } else if (attempts < 20) {
          attempts += 1
          timer = window.setTimeout(() => void poll(), 1_500)
        }
      } catch (requestError) {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Не вдалося перевірити оплату.')
        }
      }
    }
    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [code, loading])

  const cancel = async () => {
    if (!code) return
    setIsCancelling(true)
    setError('')
    try {
      const response = await api.cancelLiqpayPayment(code)
      setStatus(response.order.paymentStatus)
      if (response.order.paymentStatus !== 'pending') await onSettledRef.current()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося скасувати спробу оплати.')
    } finally {
      setIsCancelling(false)
    }
  }

  if (!code)
    return (
      <main className="main-content confirmation">
        <p className="eyebrow">Velora</p>
        <h1>Не знайшли платіж</h1>
        <p>Відкрийте сторінку оплати зі свого особистого кабінету або кошика.</p>
        <Link className="button-dark" to="/account">
          До кабінету
        </Link>
      </main>
    )

  const current = paymentLabels[status] ?? paymentLabels.pending
  return (
    <main className="main-content confirmation payment-result">
      <div className={`confirmation-mark payment-mark payment-mark-${status}`}>
        <Icon name={status === 'paid' ? 'check' : 'shield'} size={38} />
      </div>
      <p className="eyebrow">{current.eyebrow}</p>
      <h1>{current.title}</h1>
      <p>{current.text}</p>
      <small>Замовлення № {code}</small>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {status === 'pending' && (
        <button className="text-link" disabled={isCancelling} onClick={() => void cancel()}>
          {isCancelling ? 'Скасовуємо…' : 'Скасувати незавершену оплату'}
        </button>
      )}
      {status === 'paid' ? (
        <Link className="button-dark" to="/account">
          Переглянути замовлення
        </Link>
      ) : status !== 'pending' ? (
        <Link className="button-dark" to="/cart">
          Повернутися до кошика
        </Link>
      ) : null}
    </main>
  )
}
