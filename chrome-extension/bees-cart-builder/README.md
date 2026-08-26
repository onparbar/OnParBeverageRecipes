# On Par Vendor Cart Builder

This local Chrome extension receives an approved Heidelberg, Proof, or OHLQ
order from `https://onparbev.com`, opens the existing signed-in vendor session,
and fills the cart using exact product or SKU matches.

It never reads or stores a password, cookies, or credentials. Order details are
kept only in Chrome session storage and are removed when the cart-building run
finishes. Ambiguous or missing products are left for review. The extension has
no checkout, submit-order, or payment code.

## One-time Chrome setup

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `chrome-extension/bees-cart-builder` folder.

After setup, approve a vendor draft in the Weekly Plan and choose **Build BEES
cart**, **Build Proof cart**, or **Build OHLQ cart**. Keep each vendor account
signed in through Chrome as usual. The assistant stops at a review-ready cart
and never submits an order.
