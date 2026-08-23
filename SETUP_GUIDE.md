# Nail Website - Place An Order Feature - Setup Guide

## ✅ What's Been Created:

### 1. **New Order Page** (`order.html`)
A complete order form with:
- Sizing instructions with reference photo gallery
- Qatari coin (dirham) sizing guide
- File uploads for left hand sizing photos
- File uploads for right hand sizing photos  
- Optional inspiration photo uploads
- Customer details section (phone, special requests)
- Delivery method selection (Pickup or Delivery)
- Professional styling matching your main website

### 2. **Navigation Updates** (`index.html`)
- Updated "Order Now" button in nav to point to `order.html`
- Updated hero CTA from "DM to Order" to "Place An Order"
- Mobile menu updated with order.html link
- All navigation buttons now direct to the new order page

### 3. **Sizing Reference Folder** (`brand_assets/sizing-reference/`)
Ready to receive your reference images

---

## 📸 NEXT STEP: Add Sizing Reference Photos

You provided 3 excellent reference photos showing proper nail sizing with a Qatari coin.

**Add these to the sizing-reference folder:**

1. Save the three photos you provided to: `brand_assets/sizing-reference/`
2. Rename them as:
   - `sizing-1.jpg` (single finger shot)
   - `sizing-2.jpg` (two fingers shot)
   - `sizing-3.jpg` (full hand reference)

The order.html page will automatically display these in the sizing guide section.

---

## 🎨 Form Features Included:

✅ **Sizing Section:**
- Clear instructions on using Qatari coin reference
- Emphasis on photographing both hands
- Gallery of your reference photos

✅ **File Uploads:**
- Left hand sizing photos (required)
- Right hand sizing photos (required)
- Inspiration photos (optional)
- Drag-and-drop support
- File previews with remove option

✅ **Customer Details:**
- Phone number field (required)
- Special requests/comments textarea
- Radio buttons for delivery method selection

✅ **User Experience:**
- Form validation
- Success message on submit
- Mobile-responsive design
- Consistent styling with main website
- Smooth animations and transitions

---

## Order Submission Configuration

The order form submits to `/api/orders`. Configure these environment variables in Vercel before deploying:

| Variable | Required | Purpose |
| --- | --- | --- |
| `POSTGRES_URL` | Yes in production | Vercel Postgres connection string. Production requests fail rather than falling back to memory when this is absent. |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary account name for uploaded order images. |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Yes | Cloudinary API secret. |
| `ORDER_EMAIL_NOTIFICATIONS` | No | Set to exactly `true` to send a confirmation email on each order. Defaults to off — orders always save to Postgres and show in Admin -> Orders regardless of this setting; it only controls the optional email step. |
| `EMAIL_USER` | Only if `ORDER_EMAIL_NOTIFICATIONS=true` | Gmail address used to send order notifications. `GMAIL_USER` is also supported. No hardcoded fallback — if this isn't set (or not visible in the current Vercel environment), sending is skipped with a logged reason rather than silently using the wrong account. |
| `EMAIL_PASS` | Only if `ORDER_EMAIL_NOTIFICATIONS=true` | Gmail app password. `GMAIL_APP_PASSWORD` is also supported. Spaces are stripped automatically (Google displays app passwords as "abcd efgh ijkl mnop"). |
| `EMAIL_TO` | Only if `ORDER_EMAIL_NOTIFICATIONS=true` | Inbox that receives order notifications. No hardcoded fallback. |
| `EMAIL_FROM` | Optional | From address shown on notification emails. Defaults to the `EMAIL_USER` address, which is what Gmail expects. |
| `ADMIN_PASSWORD` | Yes for admin access | Password for the admin dashboard. |
| `ADMIN_JWT_SECRET` | Yes for admin access | Long random secret used to sign admin sessions. |

Create the Vercel Postgres database and connect it to this project so Vercel provides `POSTGRES_URL`. The `orders` table is created automatically on the first authenticated admin order request or public order submission.

---

## 🚀 Quick Links:
- Main Website: `index.html`
- Order Page: `order.html`
- Reference Photos: `brand_assets/sizing-reference/`

Everything is styled to match your beautiful website design!
