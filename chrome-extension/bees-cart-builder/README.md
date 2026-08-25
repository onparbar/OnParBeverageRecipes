# On Par BEES Cart Builder

This local Chrome extension receives an approved Heidelberg order from
`https://onparbev.com`, opens the existing signed-in BEES session, and fills the
cart using exact product matches.

It never reads or stores a password, cookies, or credentials. Order details are
kept only in Chrome session storage and are removed when the cart-building run
finishes. Ambiguous or missing products are left for review. The extension has
no checkout, submit-order, or payment code.

## One-time Chrome setup

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `chrome-extension/bees-cart-builder` folder.

After setup, approve the Heidelberg draft in the Weekly Plan and choose
**Build BEES cart**. Keep the BEES account signed in through Chrome as usual.
