/*
 * One-time content migration: seeds the Cloudinary-backed content store with
 * the exact copy that is currently hardcoded in index.html / order.html /
 * styles-*.html, so switching those pages to read from the CMS does not
 * change anything the public sees on day one.
 *
 * Run locally with production Cloudinary credentials in the environment, e.g.:
 *   CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... npm run migrate:content
 * (or `vercel env pull .env.local` and load that file into your shell first)
 *
 * Safe to re-run: it always overwrites both the draft and published copy of
 * each section, so running it again just re-seeds the defaults.
 */

const { getCloudinaryState } = require('../server/cloudinary-client');
const { seedSection } = require('../server/content-store');

const SEED_DATA = {
  navigation: {
    logoLine1: 'Nail it',
    logoLine2: 'by K',
    items: [
      { id: 'how', label: 'How it Works', href: '#how', visible: true },
      { id: 'styles', label: 'Styles', href: '#styles', visible: true },
      { id: 'gallery', label: 'Gallery', href: '#gallery', visible: true },
      { id: 'pricing', label: 'Orders & Pricing', href: '#pricing', visible: true },
      { id: 'faq', label: 'FAQ', href: '#faq', visible: true },
    ],
    cta: { label: 'Order Now 💅', href: 'order.html' },
  },

  footer: {
    tagline: 'Custom gel press-on nails, hand-made to match your inspo and delivered to your door across Qatar.',
    instagramUrl: 'https://instagram.com/nail.it.qa',
    navigateLinks: [
      { label: 'How it Works', href: '#how' },
      { label: 'Styles', href: '#styles' },
      { label: 'Gallery', href: '#gallery' },
      { label: 'Orders & Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Admin', href: '/admin' },
    ],
    contactLinks: [
      { label: '@nail.it.qa', href: 'https://instagram.com/nail.it.qa' },
      { label: 'DM to Order', href: '#pricing' },
      { label: 'About Us', href: '#about' },
      { label: 'Doha, Qatar', href: '#' },
    ],
    copyrightText: '© 2026 Nail it by K · All rights reserved · Doha, Qatar',
    madeWithText: 'Made with ♥ in Qatar',
  },

  faq: {
    tag: 'Questions',
    heading: 'Good questions.\nEasy answers.',
    sub: 'Everything you need to know before you order.',
    items: [
      {
        id: 'faq-1',
        question: 'How do I order?',
        answer: "DM us on Instagram @nail.it.qa with your inspo photos. We'll confirm your order, discuss sizing, and handle everything from there.",
        order: 0,
        visible: true,
      },
      {
        id: 'faq-2',
        question: 'How long does it take?',
        answer: "Turnaround time depends on the complexity of the design. We'll give you an estimated timeframe when you place your order — simple sets are always quicker!",
        order: 1,
        visible: true,
      },
      {
        id: 'faq-3',
        question: 'Do you deliver across all of Qatar?',
        answer: 'Yes! We deliver across Qatar. Delivery is included in all set prices. DM us for details on timings and your specific area.',
        order: 2,
        visible: true,
      },
      {
        id: 'faq-4',
        question: 'Are press-ons reusable?',
        answer: "Absolutely. Our gel press-on sets are made to be reapplied. Remove gently, clean, and store safely — they'll look just as good the second time around.",
        order: 3,
        visible: true,
      },
      {
        id: 'faq-5',
        question: 'Can I send my own inspo photos?',
        answer: "That's exactly how it works! Send us your saved inspo, a Pinterest board, TikTok screenshots — anything goes. We'll match the vibe and make it yours.",
        order: 4,
        visible: true,
      },
      {
        id: 'faq-6',
        question: 'What shapes and lengths do you offer?',
        answer: 'We do almond, square, coffin, stiletto, oval and more. Short, medium or long — just let us know your preference when ordering.',
        order: 5,
        visible: true,
      },
      {
        id: 'faq-7',
        question: 'How do I apply them?',
        answer: 'We include instructions with every order. You can use nail glue for a longer hold, or nail tabs for a gentler option — perfect for events.',
        order: 6,
        visible: true,
      },
      {
        id: 'faq-8',
        question: 'Do you do sets for special occasions?',
        answer: 'Of course! Weddings, graduations, birthdays, Eid — we love a special occasion set. Order early to make sure your nails are ready in time.',
        order: 7,
        visible: true,
      },
    ],
  },

  branding: {
    businessName: 'Nail it by K',
    siteTitle: 'Nail it by K',
    instagramHandle: '@nail.it.qa',
    instagramUrl: 'https://instagram.com/nail.it.qa',
    logos: { main: null, mobile: null, footer: null, favicon: null },
    colors: { primary: '#F5279A', secondary: '#CBA6D9', accent: '#FF5AA6' },
    placeholders: { productFallback: 'brand_assets/nail logo.jpg', galleryFallback: '' },
  },

  homepage: {
    hero: {
      pillText: '✦ Now taking orders',
      pillLocation: 'Doha, Qatar',
      headingLine1: 'You dream it,',
      headingEmphasis: 'we nail it.',
      description: 'Custom gel press-on sets, hand-made to match your inspo and delivered to your door across Qatar. No salon chair. No waiting. Just perfect nails.',
      primaryButton: { label: 'Place An Order 💅', href: 'order.html' },
      secondaryButton: { label: 'See How it Works', href: '#how' },
      stats: [
        { value: '100%', label: 'Hand-made' },
        { value: 'Qatar', label: 'Wide Delivery' },
        { value: 'Any', label: 'Design, Any Style' },
      ],
    },
    marquee: {
      items: [
        'Chrome Nails', 'French Tips', '3D Charms', 'Jelly Nails', 'Press-Ons',
        'Custom Gel Sets', 'Qatar Delivery', 'Almond Shape', 'Square Shape', 'Reusable Sets',
      ],
    },
    howItWorks: {
      tag: 'The process',
      heading: 'Simple as 1, 2, 3.',
      sub: 'No appointments, no waiting rooms. Just send your inspo and we handle everything.',
      steps: [
        { icon: '📸', title: 'Send your inspo', text: 'DM us your nail inspiration photos on Instagram — any design, any style, any vibe.' },
        { icon: '✨', title: 'We hand-make it', text: 'K crafts your custom gel press-on set from scratch, matching your inspo perfectly.' },
        { icon: '📦', title: 'Delivered to you', text: 'Your set arrives at your door across Qatar, ready to wear — again and again.' },
      ],
    },
    stylesSection: {
      tag: 'What we do',
      heading: 'Any style.\nMade for you.',
      sub: 'From everyday classics to statement sets — if you can dream it, we can nail it.',
      cards: [
        { category: 'Chrome', title: 'Chrome', subtitle: 'Reflective, ultra-glossy finish', href: 'styles-chrome.html' },
        { category: 'French Tips', title: 'French Tips', subtitle: 'Classic clean lines, your way', href: 'styles-french-tips.html' },
        { category: 'Cateye', title: 'Cateye', subtitle: 'Sculpted curves with a luxe finish', href: 'styles-cateye.html' },
        { category: '3D Art', title: '3D Art', subtitle: 'Gems, charms & dimensional detail', href: 'styles-3d-art.html' },
      ],
    },
    whyUs: {
      tag: 'Why Nail it by K',
      heading: 'Salon-worthy nails,\non your schedule.',
      sub: 'We do things differently — and your nails will show it.',
      cards: [
        { icon: '🎨', title: 'Soft & sweet', text: 'Pretty pinks, a warm and caring approach. Every set starts with your vision and ends with something better than you imagined.' },
        { icon: '🔥', title: 'Bold & trendy', text: 'On top of every trend — chrome, French, jelly, 3D charms. Confident, never shy about going bold.' },
        { icon: '💝', title: 'Made for you', text: 'Every single set is personal. We speak to you one-to-one, like a friend with great taste who just happens to be excellent with nails.' },
        { icon: '✅', title: 'Easy & honest', text: 'Simple to order, fair on price, no fuss. Approachable beauty without the salon markup — the friendliest set in Qatar.' },
      ],
    },
    gallerySection: {
      tag: 'The work',
      heading: "Fresh from K's hands.",
      sub: 'Every set is one-of-a-kind - here are some photos from our clients.',
    },
    orderCta: {
      tag: '✦ Now taking orders',
      heading: 'Every set is priced\njust for you.',
      description: "Pricing depends on your design, shape, and level of detail — so we keep it personal. DM us with your inspo and we'll send you a quote. No commitment needed.",
      pillText: "💬 It's as easy as sending a message",
      primaryButton: { label: 'DM for Orders & Prices 💌', href: 'https://instagram.com/nail.it.qa' },
      secondaryLink: { label: '@nail.it.qa', href: 'https://instagram.com/nail.it.qa' },
    },
  },
};

async function main() {
  const { cloudinary, initError, missingConfig } = getCloudinaryState();

  if (!cloudinary) {
    console.error('Cloudinary failed to initialize:', initError?.message || initError);
    process.exit(1);
  }

  if (missingConfig.length) {
    console.error('Missing required Cloudinary env vars:', missingConfig.join(', '));
    process.exit(1);
  }

  const keys = Object.keys(SEED_DATA);
  console.log(`Seeding ${keys.length} content sections: ${keys.join(', ')}`);

  for (const key of keys) {
    process.stdout.write(`  - ${key} ... `);
    await seedSection(cloudinary, key, SEED_DATA[key]);
    console.log('done');
  }

  console.log('Migration complete. Draft and published copies now match the current live site.');
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
