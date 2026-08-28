# On Par Vendor Cart Builder: Private Chrome Web Store Release

## Recommended distribution

Publish this extension as **Private** and allow only approved manager Google accounts or an approved Google Group. Do not distribute it to general staff accounts. Private, unlisted, and public extensions all go through Chrome Web Store review.

Official references:

- https://developer.chrome.com/docs/webstore/publish/
- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- https://developer.chrome.com/docs/webstore/update/

## Package

- File: `release-artifacts/On-Par-Vendor-Cart-Builder-1.2.3.zip`
- Manifest version: `1.2.3`
- The ZIP root contains `manifest.json`; do not place the extension inside another folder before uploading.
- Never add `.env` files, browser profiles, cookies, passwords, dashboard exports, vendor downloads, or order data to the ZIP.

## Before uploading

1. Use the Google account that should own the On Par extension.
2. Enable two-step verification for that Google account.
3. Register the account in the Chrome Web Store Developer Dashboard.
4. Choose **Add new item** and upload the versioned ZIP.
5. Complete the Store Listing, Privacy, Distribution, and Test Instructions sections.
6. Set visibility to **Private**.
7. Add only approved manager Google accounts or an approved Google Group.
8. Use deferred publishing if On Par wants to choose the exact release time after review.

## Ready-to-paste listing copy

### Name

On Par Vendor Cart Builder

### Summary

Builds review-only BEES, Proof, and OHLQ carts from approved On Par weekly orders.

### Detailed description

On Par Vendor Cart Builder is an internal ordering assistant for authorized On Par managers. It transfers approved weekly order lines from the On Par Beverage Dashboard to supported vendor websites and prepares carts for manager review.

The extension never submits an order, completes checkout, selects a payment method, or stores vendor passwords. Managers remain responsible for signing in to each vendor, reviewing product identity, package size, quantity, availability, substitutions, pricing, and the final order before submission.

Supported services are the On Par Beverage Dashboard, BEES, Proof, and OHLQ.

### Single purpose

Prepare review-only vendor carts from manager-approved On Par beverage orders.

### Category

Productivity

## Permission explanations

### Storage

Temporarily stores the approved handoff and cart-building status inside Chrome's private extension storage so work can continue safely when a vendor page opens or reloads. It does not store passwords, payment details, or vendor session cookies.

### Tabs

Opens or focuses the supported vendor page requested by an authorized manager and coordinates the review-only cart-building flow across that tab. It does not submit checkout.

### Website access

- `onparbev.com`: reads the manager-approved vendor handoff created by the Beverage Dashboard.
- `mybeesapp.com`: locates approved BEES products and prepares their requested quantities for review.
- `*.sgproof.com`: locates approved Proof products and prepares their requested quantities for review.
- `*.ohlq.com`: locates approved OHLQ products and prepares their requested quantities for review.

Access is intentionally restricted to those supported sites.

## Privacy disclosure draft

### Data handled

The extension handles approved order item names, product or SKU identifiers when available, package information, requested quantities, vendor names, and temporary cart-building results.

### Data not handled

The extension does not collect or store passwords, payment-card information, bank information, private messages, browsing history outside the supported sites, advertising identifiers, health information, or precise location.

### Data use

Order information is used only to prepare the manager-requested vendor cart. It is not sold, used for advertising, used for credit decisions, or shared with unrelated third parties. Temporary workflow state remains in Chrome's private extension storage on the authorized computer.

### Public privacy-policy URL

Before submission, publish the final approved policy on an On Par-controlled public URL and enter that URL in the Web Store Privacy section. Do not claim the URL exists until it has been published and reviewed.

## Reviewer instructions

1. Install the private extension in Chrome.
2. Sign in to an authorized test account on the On Par Beverage Dashboard.
3. Open an approved or rehearsal Weekly Plan.
4. Choose a supported vendor and select **Build cart**.
5. Confirm the extension opens the correct vendor site and prepares only the approved products and quantities.
6. Confirm unmatched or ambiguous items stop for manual review.
7. Confirm the extension never submits the order or enters checkout.

If Chrome review requires credentials, create limited test credentials that cannot place a real order. Never provide a manager's production password in the submission.

## Store assets still needed

- Use `chrome-extension/bees-cart-builder/icons/icon-128.png` as the listing icon.
- Capture at least one clean screenshot of the approved order handoff and one of a review-only vendor result.
- Remove account names, email addresses, order numbers, customer identifiers, and browser tabs unrelated to the extension from screenshots.
- Use the exact image dimensions requested by the current Chrome Developer Dashboard.

## Release and update procedure

1. Run the repository tests, lint, and production build.
2. Test BEES, Proof, and OHLQ in rehearsal mode without submitting an order.
3. Increase the extension version in `manifest.json` for every Web Store update.
4. Build a new ZIP whose filename includes the same version.
5. Upload the ZIP to the existing Web Store item.
6. Submit the update for review.
7. After approval, test installation with one manager account before expanding the private tester list.
8. Keep the prior accepted ZIP available for rollback.

## Authorized-computer setup

Each authorized computer must separately sign in to the owner Beverage Dashboard account and its own BEES, Proof, and OHLQ sessions. Installing the extension does not copy credentials or vendor sessions from another computer.
