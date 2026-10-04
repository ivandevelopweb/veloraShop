import { Link } from 'react-router-dom'
import { InfoPage } from './InfoPage'

export function Contacts() {
  return (
    <InfoPage
      eyebrow="Ми на зв’язку"
      title="Контакти"
      introduction="Потрібна допомога з вибором товару чи оформленням замовлення? Напишіть нам або перегляньте інформацію у своєму кабінеті."
      sections={[
        {
          number: '01',
          title: 'Електронна пошта',
          content: (
            <p>
              Напишіть на{' '}
              <a className="text-link" href="mailto:support@velora.ua">
                support@velora.ua
              </a>
              . Коротко опишіть питання, щоб ми швидше зорієнтувалися.
            </p>
          ),
        },
        {
          number: '02',
          title: 'Графік роботи',
          content: (
            <p>
              Понеділок–п’ятниця, 09:00–18:00; субота, 10:00–15:00 за київським часом. Звернення у
              вихідний день опрацюємо наступного робочого дня.
            </p>
          ),
        },
        {
          number: '03',
          title: 'Номер замовлення',
          content: (
            <p>
              Додайте до листа номер замовлення та адресу електронної пошти, вказану під час
              покупки. Переглянути замовлення можна у{' '}
              <Link className="text-link" to="/account">
                кабінеті
              </Link>
              .
            </p>
          ),
        },
      ]}
    />
  )
}
