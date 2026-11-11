/**
 * Static catalog fixtures for the dev seed. Prices are in RUPEES here for
 * readability; seed.ts converts to paisa.
 */

export type OptionSpec = { name: string; values: { value: string; hex?: string }[] };

export type ProductSpec = {
  title: string;
  price: number;
  compareAt?: number;
  options?: OptionSpec[];
  tags?: string[];
  impulse?: boolean;
  /** Price override per option value (first option), e.g. sizes. */
  priceByValue?: Record<string, number>;
};

export type CategorySpec = {
  name: string;
  slug: string;
  icon: string;
  color: string;
  products: ProductSpec[];
};

const PASTELS: OptionSpec = {
  name: "Color",
  values: [
    { value: "Pink", hex: "#F7C5D1" },
    { value: "Mint", hex: "#BFE8D6" },
    { value: "Sky", hex: "#BFD9F2" },
    { value: "Cream", hex: "#F3EBD8" },
  ],
};
const MONO: OptionSpec = {
  name: "Color",
  values: [
    { value: "White", hex: "#FFFFFF" },
    { value: "Black", hex: "#222222" },
    { value: "Grey", hex: "#B9B9B9" },
  ],
};
const SML: OptionSpec = { name: "Size", values: [{ value: "S" }, { value: "M" }, { value: "L" }] };

export const CATEGORIES: CategorySpec[] = [
  {
    name: "Home Organizers", slug: "home-organizers", icon: "box", color: "#E8DCC8",
    products: [
      { title: "Stackable Clear Storage Box", price: 699, options: [SML], priceByValue: { S: 499, M: 699, L: 999 }, tags: ["best-seller"] },
      { title: "Foldable Fabric Drawer Cube", price: 899, options: [PASTELS] },
      { title: "Cable Organizer Box", price: 1199, options: [MONO], tags: ["new"] },
      { title: "Under-Shelf Hanging Basket", price: 549 },
      { title: "Drawer Divider Set (6 pcs)", price: 799, tags: ["best-seller"] },
      { title: "Over-Door 6-Hook Rack", price: 449, impulse: false },
      { title: "Mini Desktop Drawer", price: 999, options: [PASTELS], tags: ["new"] },
      { title: "Vacuum Storage Bags (3 pcs)", price: 1299 },
      { title: "Adhesive Wall Hooks (8 pcs)", price: 249, impulse: true, tags: ["best-seller"] },
      { title: "Shoe Box Organizer", price: 399, options: [MONO] },
    ],
  },
  {
    name: "Kitchen & Dining", slug: "kitchen", icon: "utensils", color: "#F6D7C3",
    products: [
      { title: "Glass Food Container Set", price: 1899, compareAt: 2299, tags: ["best-seller"] },
      { title: "Silicone Spatula", price: 349, options: [PASTELS], impulse: true },
      { title: "Collapsible Silicone Water Bottle", price: 899, options: [PASTELS], tags: ["new"] },
      { title: "Ceramic Bowl with Bamboo Lid", price: 749 },
      { title: "Stainless Steel Lunch Box", price: 1499, options: [MONO] },
      { title: "Reusable Bag Clips (12 pcs)", price: 199, impulse: true, tags: ["best-seller"] },
      { title: "Mini Garlic Chopper", price: 599, tags: ["new"] },
      { title: "Bamboo Chopsticks (5 pairs)", price: 299, impulse: true },
      { title: "Insulated Coffee Tumbler", price: 1299, options: [MONO, ], tags: ["best-seller"] },
      { title: "Spice Jar Set with Labels", price: 999 },
      { title: "Silicone Ice Cube Tray", price: 449, options: [PASTELS] },
    ],
  },
  {
    name: "Stationery", slug: "stationery", icon: "pen", color: "#D7E3F4",
    products: [
      { title: "Gel Pen Set (6 colours)", price: 349, impulse: true, tags: ["best-seller"] },
      { title: "Dotted A5 Notebook", price: 449, options: [PASTELS], tags: ["best-seller"] },
      { title: "Pastel Highlighters (5 pcs)", price: 399, tags: ["best-seller"] },
      { title: "Sticky Notes Mega Pack", price: 249, impulse: true },
      { title: "Washi Tape Set (8 rolls)", price: 449, tags: ["new"] },
      { title: "Weekly Desk Planner Pad", price: 549 },
      { title: "Cute Animal Erasers (4 pcs)", price: 149, impulse: true },
      { title: "Mechanical Pencil 0.5mm", price: 199, options: [PASTELS], impulse: true },
      { title: "Zip Pencil Pouch", price: 499, options: [PASTELS] },
      { title: "Mini Stapler Set", price: 299, impulse: true, tags: ["new"] },
      { title: "Kraft Paper Sketchbook", price: 699 },
    ],
  },
  {
    name: "Mini Tech", slug: "mini-tech", icon: "zap", color: "#E3DAF2",
    products: [
      { title: "Handheld Mini Fan", price: 1299, options: [PASTELS], tags: ["best-seller"] },
      { title: "Wireless Earbuds Lite", price: 2999, compareAt: 3499, options: [MONO], tags: ["best-seller"] },
      { title: "10000mAh Slim Power Bank", price: 2799, options: [MONO], tags: ["new"] },
      { title: "Braided USB-C Cable 1m", price: 549, impulse: false, tags: ["best-seller"] },
      { title: "Phone Stand (Foldable)", price: 449 },
      { title: "LED Desk Lamp with Clip", price: 1599 },
      { title: "Bluetooth Mini Speaker", price: 2499, options: [PASTELS] },
      { title: "Cable Protectors (10 pcs)", price: 199, impulse: true },
      { title: "Fast Wall Charger 20W", price: 1199, tags: ["new"] },
      { title: "Keychain Phone Ring Holder", price: 249, impulse: true },
    ],
  },
  {
    name: "Beauty & Self-care", slug: "beauty", icon: "sparkles", color: "#F7D6DE",
    products: [
      { title: "Sheet Mask Variety (5 pcs)", price: 899, tags: ["best-seller"] },
      { title: "Fluffy Hair Claw Clip", price: 299, options: [PASTELS], impulse: true, tags: ["best-seller"] },
      { title: "Makeup Brush Set (8 pcs)", price: 1499 },
      { title: "Compact Folding Mirror", price: 399, options: [PASTELS] },
      { title: "Silk Scrunchies (3 pcs)", price: 349, impulse: true },
      { title: "Travel Bottle Set", price: 599, tags: ["new"] },
      { title: "Cotton Pads (150 pcs)", price: 249, impulse: true },
      { title: "Microfibre Hair Towel", price: 799, options: [PASTELS] },
      { title: "Lip Balm Trio", price: 499, tags: ["new"] },
      { title: "Nail Care Kit", price: 699 },
    ],
  },
  {
    name: "Bath & Laundry", slug: "bath-laundry", icon: "droplet", color: "#CFE6EE",
    products: [
      { title: "Diatomite Bath Mat", price: 1799, options: [MONO], tags: ["best-seller"] },
      { title: "Toothbrush Holder Cup", price: 349, options: [PASTELS] },
      { title: "Shower Caddy Corner Shelf", price: 1199 },
      { title: "Mesh Laundry Bags (3 pcs)", price: 499 },
      { title: "Foldable Laundry Basket", price: 1299, options: [MONO] },
      { title: "Soap Dish Self-Draining", price: 299, impulse: true },
      { title: "Clothes Pegs (24 pcs)", price: 249, impulse: true },
      { title: "Lint Roller with Refills", price: 449, tags: ["new"] },
      { title: "Bath Sponge Set", price: 299, impulse: true },
      { title: "Velvet Non-slip Hangers (10 pcs)", price: 999, tags: ["best-seller"] },
    ],
  },
  {
    name: "Toys & Plush", slug: "toys", icon: "smile", color: "#FCE8B2",
    products: [
      { title: "Bunny Plush 25cm", price: 1499, options: [PASTELS], tags: ["best-seller"] },
      { title: "Squishy Stress Ball", price: 199, impulse: true },
      { title: "Mini Puzzle Cube", price: 349, impulse: true },
      { title: "Bear Plush Keychain", price: 449, options: [PASTELS], tags: ["new"] },
      { title: "Bubble Wand Set", price: 299, impulse: true },
      { title: "Shiba Inu Pillow", price: 2299, tags: ["best-seller"] },
      { title: "DIY Sticker Book", price: 399 },
      { title: "Wind-up Toy Trio", price: 499, tags: ["new"] },
      { title: "Mini Building Blocks", price: 899 },
      { title: "Penguin Plush 15cm", price: 999, options: [PASTELS] },
    ],
  },
  {
    name: "Bags & Travel", slug: "bags-travel", icon: "briefcase", color: "#DCE8D2",
    products: [
      { title: "Canvas Tote Bag", price: 899, options: [PASTELS], tags: ["best-seller"] },
      { title: "Packing Cubes (4 pcs)", price: 1799, tags: ["best-seller"] },
      { title: "Neck Pillow Memory Foam", price: 1499, options: [MONO] },
      { title: "Travel Toiletry Pouch", price: 799, options: [PASTELS], tags: ["new"] },
      { title: "Luggage Tag Set", price: 349, impulse: true },
      { title: "Mini Crossbody Bag", price: 1999, options: [MONO] },
      { title: "Foldable Shopping Bag", price: 299, impulse: true },
      { title: "Passport Holder", price: 599, options: [PASTELS] },
      { title: "Eye Mask with Ear Plugs", price: 399, impulse: false },
      { title: "Drawstring Gym Bag", price: 699, tags: ["new"] },
    ],
  },
  {
    name: "Fragrance & Candles", slug: "fragrance", icon: "flame", color: "#F2E1C9",
    products: [
      { title: "Reed Diffuser 100ml", price: 1299, options: [{ name: "Scent", values: [{ value: "White Tea" }, { value: "Lavender" }, { value: "Ocean" }] }], tags: ["best-seller"] },
      { title: "Scented Tea Light Candles (12)", price: 599 },
      { title: "Car Air Freshener Clip", price: 349, impulse: true, tags: ["new"] },
      { title: "Soy Candle in Glass Jar", price: 999, options: [{ name: "Scent", values: [{ value: "Vanilla" }, { value: "Rose" }, { value: "Sandalwood" }] }] },
      { title: "Wardrobe Scent Sachets (4)", price: 249, impulse: true },
      { title: "Mini Perfume Rollerball", price: 799, tags: ["best-seller"] },
      { title: "Aroma Oil Burner", price: 1199 },
      { title: "Room Spray 200ml", price: 699 },
      { title: "Incense Sticks Variety", price: 299, impulse: true },
      { title: "Diffuser Refill 200ml", price: 899 },
    ],
  },
  {
    name: "Desk & Office", slug: "desk-office", icon: "monitor", color: "#E0E4E8",
    products: [
      { title: "Felt Desk Mat", price: 1299, options: [MONO], tags: ["best-seller"] },
      { title: "Monitor Riser with Drawer", price: 2499 },
      { title: "Magnetic Whiteboard A4", price: 799 },
      { title: "Mesh Pen Holder", price: 349, options: [MONO], impulse: false },
      { title: "Wrist Rest Pad", price: 599, tags: ["new"] },
      { title: "Document File Organizer", price: 999 },
      { title: "Binder Clips Assorted (40)", price: 199, impulse: true },
      { title: "Acrylic Desk Calendar", price: 649, tags: ["new"] },
      { title: "Cable Clips Adhesive (6)", price: 249, impulse: true },
      { title: "Bookends Pair", price: 899, options: [MONO] },
    ],
  },
  {
    name: "Seasonal & Gifts", slug: "gifts", icon: "gift", color: "#F5D0C5",
    products: [
      { title: "Gift Box with Ribbon", price: 349, options: [SML], priceByValue: { S: 249, M: 349, L: 499 } },
      { title: "Greeting Card Set (6)", price: 299, impulse: true },
      { title: "Fairy String Lights 3m", price: 799, tags: ["best-seller"] },
      { title: "Photo Clip String", price: 449, tags: ["new"] },
      { title: "Mini Succulent (Faux)", price: 399, impulse: false },
      { title: "Party Balloon Pack", price: 249, impulse: true },
      { title: "Gift Wrap Paper Roll", price: 199, impulse: true },
      { title: "Mug with Spoon Gift Set", price: 1099, options: [PASTELS] },
      { title: "Polaroid-style Photo Frames", price: 699 },
      { title: "Scented Gift Hamper", price: 2999, compareAt: 3599, tags: ["best-seller"] },
    ],
  },
  {
    name: "Pets", slug: "pets", icon: "paw", color: "#E9DFD3",
    products: [
      { title: "Cat Teaser Wand", price: 349, impulse: true, tags: ["best-seller"] },
      { title: "Pet Food Bowl Ceramic", price: 799, options: [PASTELS] },
      { title: "Pet Grooming Glove", price: 599, tags: ["new"] },
      { title: "Plush Squeaky Toy", price: 449, options: [PASTELS] },
      { title: "Pet Waste Bags (8 rolls)", price: 399 },
      { title: "Collapsible Travel Bowl", price: 499 },
      { title: "Catnip Ball Set", price: 299, impulse: true },
      { title: "Pet Blanket Fleece", price: 1299, options: [SML], priceByValue: { S: 999, M: 1299, L: 1599 } },
      { title: "Lint Brush for Pet Hair", price: 549, tags: ["best-seller"] },
      { title: "Pet ID Tag", price: 249, impulse: true },
    ],
  },
];

/** [name, province, zone] — zones: LAHORE (local), MAJOR, NATIONWIDE */
export const CITIES: [string, string, "Lahore" | "Major Cities" | "Nationwide"][] = [
  ["Lahore", "Punjab", "Lahore"],
  ["Karachi", "Sindh", "Major Cities"],
  ["Islamabad", "ICT", "Major Cities"],
  ["Rawalpindi", "Punjab", "Major Cities"],
  ["Faisalabad", "Punjab", "Major Cities"],
  ["Multan", "Punjab", "Major Cities"],
  ["Gujranwala", "Punjab", "Major Cities"],
  ["Sialkot", "Punjab", "Major Cities"],
  ["Peshawar", "Khyber Pakhtunkhwa", "Major Cities"],
  ["Hyderabad", "Sindh", "Major Cities"],
  ["Quetta", "Balochistan", "Nationwide"],
  ["Bahawalpur", "Punjab", "Nationwide"],
  ["Sargodha", "Punjab", "Nationwide"],
  ["Sukkur", "Sindh", "Nationwide"],
  ["Larkana", "Sindh", "Nationwide"],
  ["Sheikhupura", "Punjab", "Nationwide"],
  ["Gujrat", "Punjab", "Nationwide"],
  ["Sahiwal", "Punjab", "Nationwide"],
  ["Okara", "Punjab", "Nationwide"],
  ["Kasur", "Punjab", "Nationwide"],
  ["Rahim Yar Khan", "Punjab", "Nationwide"],
  ["Jhang", "Punjab", "Nationwide"],
  ["Dera Ghazi Khan", "Punjab", "Nationwide"],
  ["Mardan", "Khyber Pakhtunkhwa", "Nationwide"],
  ["Abbottabad", "Khyber Pakhtunkhwa", "Nationwide"],
  ["Mingora", "Khyber Pakhtunkhwa", "Nationwide"],
  ["Mirpur", "Azad Kashmir", "Nationwide"],
  ["Muzaffarabad", "Azad Kashmir", "Nationwide"],
  ["Nawabshah", "Sindh", "Nationwide"],
  ["Gilgit", "Gilgit-Baltistan", "Nationwide"],
];
