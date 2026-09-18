# On Par Vendor Cart Builder — Privacy Policy

Draft prepared September 15, 2026 for extension version 1.2.11. Publish this text on an On Par-controlled public page before using it as the store privacy-policy URL.

## Purpose

On Par Vendor Cart Builder helps authorized On Par managers prepare vendor carts from approved beverage orders. It operates on onparbev.com, mybeesapp.com, supported sgproof.com pages, and supported ohlq.com pages. Managers sign in through the normal vendor websites and review their carts themselves.

## Information processed

The extension processes approved product names, internal product identifiers, vendor SKUs, package sizes, requested quantities, vendor names, order and request identifiers, operating-week references, expected totals, workflow timestamps, and cart-building results. It reads relevant product availability, product descriptions, and cart quantities on supported vendor pages. The last OHLQ result may include a delivery date and time preference.

It does not read or store passwords, authentication cookies, payment-card details, bank information, private messages, health information, precise location, or browsing history outside the supported sites. It does not include advertising or analytics services.

## How information is used and shared

Information is used to find matching products, enter requested quantities on the selected vendor website, check cart results, and show progress or exceptions. Cart-building results are sent back to the On Par Beverage Dashboard. The extension does not sell information or use it for advertising or credit decisions. It does not send order information to unrelated third parties.

The dashboard and vendor websites handle their own records and account sessions under their respective policies. The extension does not submit an order, complete checkout, or process payment.

## Storage and retention

Temporary workflow information is stored locally on the computer in Chrome's extension-private local storage. The pending order is removed when the run finishes. The last result is kept until replaced by a new run or removed by cleanup. Each time the background worker starts, it removes pending orders and results whose recorded timestamps are more than 12 hours old, or whose timestamps are invalid. Because cleanup runs on worker startup, this is not a guaranteed deletion exactly 12 hours after a run.

Removing the extension clears its local extension storage. Removing the extension does not delete products already entered in a vendor cart or records maintained by the dashboard or vendor websites.

## Control and contact

Managers choose when to start a cart build and review unmatched products and final cart contents. They may stop a running helper or remove the extension through Chrome. For questions about the extension or its handling of order information, contact the On Par Beverage Dashboard administrator through On Par's existing internal support channel.
