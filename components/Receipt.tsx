import type { ReceiptData } from "@/lib/useVoiceOrder";

const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "₹";

function money(amount: number) {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${CURRENCY}${value}`;
}

function time(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function Receipt({ receipt }: { receipt: ReceiptData | null }) {
  if (!receipt) {
    return (
      <div className="tray">
        <p>Your receipt prints here once you confirm your order.</p>
      </div>
    );
  }

  return (
    <div className="slip-wrap">
      <article className="slip" aria-label="Order receipt">
        <header className="slip__head">
          <p className="slip__title">Order {receipt.orderId}</p>
          <p className="slip__time">{time(receipt.placedAt)}</p>
        </header>

        <ul className="slip__items">
          {receipt.items.map((item, i) => (
            <li key={`${item.name}-${i}`}>
              <span>
                {item.quantity} × {item.name}
              </span>
              <span>{money(item.price)}</span>
            </li>
          ))}
        </ul>

        <div className="slip__total">
          <span>Total</span>
          <span>{money(receipt.total)}</span>
        </div>

        <p className="slip__note">Show this receipt at the counter to pay.</p>
      </article>
    </div>
  );
}
